// ==UserScript==
// @name         TW-SC-Data
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  TW-SC-Data
// @match        https://www.tradingview.com/options/chain/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. CONFIGURATION & CREDENTIALS
    // ==========================================
    function getConfig(key, defaultVal) {
        let val = typeof GM_getValue === 'function' ? GM_getValue(key, null) : null;
        if (!val) val = localStorage.getItem("CME_" + key);
        return val || defaultVal;
    }

    function setConfig(key, val) {
        if (typeof GM_setValue === 'function') GM_setValue(key, val);
        localStorage.setItem("CME_" + key, val);
    }

    let FIREBASE_URL = getConfig("FIREBASE_URL", "");
    let FIREBASE_SECRET = getConfig("FIREBASE_SECRET", "");
    let API_KEY_FOLDER = getConfig("API_KEY_FOLDER", "");

    // ⏱️ ตั้งค่าเวลา Auto-Sync (วินาที)
    const AUTO_SYNC_INTERVAL = 120;

    function askForCredentials(isError = false) {
        if (isError) alert("⚠️ Firebase แจ้งว่า URL หรือ Secret ผิดพลาด!\nกรุณาตรวจสอบและกรอกข้อมูลใหม่ให้ถูกต้อง");

        let newUrl = prompt("1. กรุณาใส่ FIREBASE_URL\n(ตัวอย่าง: https://my-project.firebaseio.com):", FIREBASE_URL);
        if (newUrl === null) return;

        let newSecret = prompt("2. กรุณาใส่ FIREBASE_SECRET\n(รหัสลับ):", FIREBASE_SECRET);
        if (newSecret === null) return;

        let newFolder = prompt("3. กรุณาใส่ API_KEY_FOLDER\n(โฟลเดอร์หลัก):", API_KEY_FOLDER);
        if (newFolder === null) return;

        if (newUrl && newSecret && newFolder) {
            FIREBASE_URL = newUrl.trim();
            FIREBASE_SECRET = newSecret.trim();
            API_KEY_FOLDER = newFolder.trim();

            setConfig("FIREBASE_URL", FIREBASE_URL);
            setConfig("FIREBASE_SECRET", FIREBASE_SECRET);
            setConfig("API_KEY_FOLDER", API_KEY_FOLDER);

            showNotification("✅ บันทึกการตั้งค่า Firebase เรียบร้อย!");
        }
    }

    if (!FIREBASE_URL || !FIREBASE_SECRET || FIREBASE_URL.includes("YOUR-PROJECT")) {
        setTimeout(() => askForCredentials(false), 2000);
    }

    // ==========================================
    // 2. ASSET MAPPING
    // ==========================================
    function getAssetInfo() {
        const url = window.location.href.toUpperCase();
        if (url.includes('COMEX%3AGC1') || url.includes('COMEX:GC1')) return { prefix: '', name: 'Gold', fallback: 'Gold (OG|GC)', isValid: true };
        if (url.includes('NYMEX%3ACL1') || url.includes('NYMEX:CL1')) return { prefix: 'Oil-', name: 'WTI Crude Oil', fallback: 'WTI Crude Oil (LO|CL)', isValid: true };
        if (url.includes('CME_MINI%3AES1') || url.includes('CME_MINI:ES1')) return { prefix: 'ES-', name: 'S&P 500', fallback: 'S&P 500 (ES|ES)', isValid: true };
        return { prefix: 'Unknown-', name: 'Unknown', fallback: 'Unknown', isValid: false };
    }

    // ==========================================
    // 3. TRADINGVIEW DATA EXTRACTION
    // ==========================================
    function extractTVData() {
        const asset = getAssetInfo();
        if (!asset.isValid) throw new Error("ไม่รองรับสินค้านี้");

        const underlyingRow = document.querySelector('tr[data-qa-id="option-chain-underlying-row"]');
        if (!underlyingRow) throw new Error("ไม่พบแถวข้อมูล Underlying");

        const symbolSpans = underlyingRow.querySelectorAll('.symbolContainer-sK5mrTim > span');
        let underlyingSymbol = "N/A";
        for (let span of symbolSpans) {
            if (!span.className) {
                underlyingSymbol = span.innerText.trim();
                break;
            }
        }

        const priceWrap = underlyingRow.querySelector('.priceWrap-sK5mrTim');
        const underlyingPrice = priceWrap ? priceWrap.querySelector('span').innerText.trim() : "N/A";

        let underlyingChange = "";

        if (priceWrap && priceWrap.nextElementSibling) {

            underlyingChange = priceWrap.nextElementSibling.innerText.trim().replace(/−/g, '-');

            // เอาเครื่องหมายเดิมออกก่อน แล้วค่อยเติมใหม่

            underlyingChange = underlyingChange.replace(/^\+/, '');

            if (!underlyingChange.startsWith('-') && underlyingChange !== "0" && underlyingChange !== "0.0") {

                underlyingChange = "+" + underlyingChange;

            }

        }

        const expGroups = document.querySelectorAll('tr .groupCell-hwGhGWMB');
        if (expGroups.length === 0) throw new Error("ไม่พบรายการ Expiration");

        const firstExpGroup = expGroups[0];
        let dteText = "N/A";
        firstExpGroup.querySelectorAll('.content-x4UVZabM').forEach(b => {
            if (b.innerText.includes("DTE")) dteText = b.innerText.replace('DTE', '').trim();
        });

        const headerTitle = `${asset.fallback} ${underlyingSymbol} (${dteText} DTE) vs ${underlyingPrice} (${underlyingChange}) - Intraday Volume`;

        const allHeaders = Array.from(document.querySelectorAll('.secondRowHead-_I7p6mOv th'));
        const strikeIndex = allHeaders.findIndex(th => th.innerText.includes('Strike'));

        if (strikeIndex === -1) throw new Error("ไม่พบคอลัมน์ Strike");

        const callHeaders = allHeaders.slice(0, strikeIndex).map(th => th.innerText.trim());
        const putHeaders = allHeaders.slice(strikeIndex + 1).map(th => th.innerText.trim());

        const callVolIdx = callHeaders.findIndex(h => h.includes('Volume'));
        const callIvIdx = callHeaders.findIndex(h => h.includes('IV'));
        const putVolIdx = putHeaders.findIndex(h => h.includes('Volume'));

        if (callVolIdx === -1 || putVolIdx === -1 || callIvIdx === -1) throw new Error("คอลัมน์ Volume/IV ไม่ครบ");

        let currentTr = firstExpGroup.parentElement.nextElementSibling;
        let chartData = [];

        while (currentTr && !currentTr.querySelector('.groupCell-hwGhGWMB')) {
            if (currentTr.hasAttribute('data-strike')) {
                let strike = currentTr.getAttribute('data-strike');
                let callTds = currentTr.querySelectorAll('td[data-cell-part="call"]');
                let putTds = currentTr.querySelectorAll('td[data-cell-part="put"]');

                if (callTds.length > 0 && putTds.length > 0) {
                    let extractNum = (text) => {
                        let match = text.replace(/,/g, '').replace(/—/g, '0').match(/-?\d+(\.\d+)?/);
                        return match ? match[0] : '0';
                    };
                    let callVol = extractNum(callTds[callVolIdx]?.innerText || '0');
                    let putVol = extractNum(putTds[putVolIdx]?.innerText || '0');
                    let callIv = parseFloat(extractNum(callTds[callIvIdx]?.innerText || '0'));

                    chartData.push({ strike, call: callVol, put: putVol, volSettle: (callIv / 100).toFixed(4) });
                }
            }
            currentTr = currentTr.nextElementSibling;
        }
        return { header: headerTitle, data: chartData };
    }

    function formatToText(rows, infoTitle) {
        var lines = [infoTitle, "Strike,Call,Put,Vol Settle"];
        rows.forEach(r => lines.push([r.strike || "", r.call || "0", r.put || "0", r.volSettle || "0.0000"].join(",")));
        return lines.join("\r\n");
    }

    // ==========================================
    // 4. UPLOAD & NOTIFICATION
    // ==========================================
    function showNotification(msg, isSilent = false) {
        if (isSilent) return;
        let toast = document.createElement('div');
        toast.innerText = msg;
        toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:#1e222d; color:#d1d4dc; padding:10px 20px; border-radius:8px; border:1px solid #434651; z-index:99999; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.5); font-size:13px;";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    function uploadToFirebase(filename, content, isAuto = false) {
        if (!FIREBASE_URL || !FIREBASE_SECRET) return;

        const safeKey = filename.replace(/\./g, '_');
        const url = `${FIREBASE_URL.replace(/\/+$/, '')}/${API_KEY_FOLDER.replace(/^\/+/, '').replace(/\/+$/, '')}/${safeKey}.json?auth=${FIREBASE_SECRET}&print=silent`;

        GM_xmlhttpRequest({
            method: "PUT", url: url, headers: { "Content-Type": "application/json" }, data: JSON.stringify(content),
            onload: function(res) {
                if (res.status >= 200 && res.status < 300) {
                    showNotification(`✅ อัปเดตสำเร็จ`, isAuto);
                    updateLastSyncUI();
                } else if (res.status === 401) askForCredentials(true);
            }
        });
    }

    function processAndUpload(isAuto = false) {
        try {
            const result = extractTVData();
            const textContent = formatToText(result.data, result.header);
            uploadToFirebase(`${getAssetInfo().prefix}IntradayData.txt`, textContent, isAuto);
        } catch (err) {
            if (!isAuto) showNotification(`⚠️ ${err.message}`);
        }
    }

    // ==========================================
    // 5. COMPACT UI & AUTO-SYNC LOGIC
    // ==========================================
    let autoSyncEnabled = true; // เปิด Auto เป็นค่าเริ่มต้น
    let timeRemaining = AUTO_SYNC_INTERVAL;
    let countdownTimer = null;

    function updateTimerUI() {
        const timerDisplay = document.getElementById('tv-timer-display');
        const dot = document.getElementById('tv-status-dot');
        const text = document.getElementById('tv-status-text');

        if (autoSyncEnabled) {
            timerDisplay.innerText = `${timeRemaining}s`;
            timerDisplay.style.color = '#d1d4dc';
            dot.style.background = '#00E676';
            dot.style.boxShadow = '0 0 6px #00E676';
            text.innerText = "Auto";
            text.style.color = "#d1d4dc";
        } else {
            timerDisplay.innerText = `OFF`;
            timerDisplay.style.color = '#787b86';
            dot.style.background = '#787b86';
            dot.style.boxShadow = 'none';
            text.innerText = "Paused";
            text.style.color = "#787b86";
        }
    }

    function updateLastSyncUI() {
        const timerDisplay = document.getElementById('tv-timer-display');
        if (timerDisplay) {
            let now = new Date();
            timerDisplay.title = `Last Sync: ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        }
    }

    function startAutoSync() {
        autoSyncEnabled = true;
        timeRemaining = AUTO_SYNC_INTERVAL;
        updateTimerUI();
        clearInterval(countdownTimer);

        countdownTimer = setInterval(() => {
            timeRemaining--;
            if (timeRemaining <= 0) {
                processAndUpload(true);
                timeRemaining = AUTO_SYNC_INTERVAL;
            }
            updateTimerUI();
        }, 1000);
    }

    function stopAutoSync() {
        autoSyncEnabled = false;
        clearInterval(countdownTimer);
        updateTimerUI();
    }

    function injectControlPanel() {
        if (document.getElementById('tv-vol2vol-panel')) return;

        let panel = document.createElement('div');
        panel.id = 'tv-vol2vol-panel';
        panel.style.cssText = `
            position: fixed; top: 80px; left: 20px; z-index: 999999;
            background: rgba(30, 34, 45, 0.85); backdrop-filter: blur(8px);
            border: 1px solid #434651; border-radius: 30px;
            display: flex; align-items: center; padding: 6px 14px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4); font-family: -apple-system, sans-serif;
            color: #d1d4dc; font-size: 13px; gap: 12px; user-select: none;
        `;

        panel.innerHTML = `
            <div id="tv-auto-toggle-btn" style="display: flex; align-items: center; gap: 6px; cursor: pointer;" title="Click to Toggle Auto-Sync">
                <div id="tv-status-dot" style="width: 8px; height: 8px; background: #00E676; border-radius: 50%; box-shadow: 0 0 5px #00E676; transition: 0.3s;"></div>
                <span id="tv-status-text" style="font-weight: 600; width: 45px;">Auto</span>
            </div>
            <div style="width: 1px; height: 16px; background: #434651;"></div>
            <div id="tv-timer-display" style="font-variant-numeric: tabular-nums; width: 25px; text-align: center; font-size: 12px; cursor: help;" title="Last Sync: -">60s</div>
            <div style="width: 1px; height: 16px; background: #434651;"></div>
            <button id="tv-manual-btn" style="background: none; border: none; color: #2962ff; cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Upload Now">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            </button>
            <button id="tv-settings-btn" style="background: none; border: none; color: #787b86; cursor: pointer; padding: 2px; display: flex; align-items: center;" title="Firebase Settings">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
        `;

        document.body.appendChild(panel);

        // Hover Effects
        const manualBtn = document.getElementById('tv-manual-btn');
        manualBtn.onmouseover = () => manualBtn.style.color = "#5c7cfa";
        manualBtn.onmouseout = () => manualBtn.style.color = "#2962ff";

        const setBtn = document.getElementById('tv-settings-btn');
        setBtn.onmouseover = () => setBtn.style.color = "#d1d4dc";
        setBtn.onmouseout = () => setBtn.style.color = "#787b86";

        // Interactions
        document.getElementById('tv-auto-toggle-btn').addEventListener('click', () => {
            autoSyncEnabled ? stopAutoSync() : startAutoSync();
        });

        manualBtn.addEventListener('click', () => {
            document.getElementById('tv-timer-display').innerText = '...';
            processAndUpload(false);
            if(autoSyncEnabled) timeRemaining = AUTO_SYNC_INTERVAL; // reset timer
        });

        setBtn.addEventListener('click', () => askForCredentials(false));
    }

    // เริ่มทำงานเมื่อเจอหัวตาราง (เพื่อความชัวร์ว่าข้อมูลมาแล้ว)
    let checkExist = setInterval(function() {
        if (document.querySelector('tr[data-qa-id="option-chain-underlying-row"]')) {
            injectControlPanel();
            startAutoSync(); // บังคับเริ่ม Auto-Sync ทันที
            setTimeout(() => processAndUpload(true), 2000); // แอบส่งข้อมูลครั้งแรกแบบเงียบๆ หลังโหลดเสร็จ 2 วิ
            clearInterval(checkExist);
        }
    }, 1000);

})();
