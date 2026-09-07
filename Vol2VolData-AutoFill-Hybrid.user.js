// ==UserScript==
// @name         Vol2VolData AutoFill (Hybrid)
// @namespace    https://github.com/pageth
// @version      3.1.0
// @description  Auto fill Intraday & OI Data with Auto-Detect Asset
// @match        https://*.tradingview.com/chart/*
// @icon         https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/refs/heads/main/tradingview.ico
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    const TARGET_NAMES = ['Round Numbers', 'Gamma Options', 'Vol2Vol'];

    const FB_BASE_URL = "https://vol2vol-db-default-rtdb.asia-southeast1.firebasedatabase.app/";
    const UPDATE_INTERVAL_MS = 100000;

    let lastPopup = null;
    let isUpdatingStealth = false;
    let initialLoadComplete = false;
    let isScanningManual = false;
    let cachedIntraday = null;
    let cachedOI = null;
    let currentSymbolPrefix = null;

    const cssHideAds = `
        #charting-ad,
        [id^="toast-"],
        div[class*="toast-"],
        div[class*="ad-container"],
        div[class*="floating-ad"],
        div[class*="ads-banner"],
        iframe[src*="googlesyndication"],
        iframe[src*="doubleclick"] {
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            height: 0 !important;
            width: 0 !important;
        }

        .layout__area--right {
            width: auto !important;
        }
    `;

    // ใช้ Standard DOM แทน GM_addStyle เพื่อให้ iPad รองรับ 100%
    const styleEl = document.createElement('style');
    styleEl.innerHTML = cssHideAds;
    if (document.head) {
        document.head.appendChild(styleEl);
    } else {
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(styleEl));
    }

    // ================= [ ระบบจัดการ API Key (ปรับเพื่อ iPad) ] =================
    function getApiKey() {
        let key = localStorage.getItem("API_KEY_FOLDER"); // ใช้ localStorage แทน GM_getValue
        if (!key) {
            key = prompt("🔑 กรุณาระบุ API Key สำหรับดึงข้อมูล Vol2Vol:");
            if (key) {
                localStorage.setItem("API_KEY_FOLDER", key.trim());
            }
        }
        return key ? key.trim() : "";
    }

    // สร้างปุ่มรีเซ็ตรหัสผ่านเล็กๆ ซ่อนไว้มุมขวาล่าง (เพราะ iPad ไม่มีเมนู Tampermonkey)
    function createResetKeyButton() {
        if (document.getElementById('tv-reset-key-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'tv-reset-key-btn';
        btn.innerHTML = '⚙️';
        btn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; font-size: 14px; 
            z-index: 2147483647; cursor: pointer; background: rgba(0,0,0,0.5); 
            border-radius: 50%; width: 25px; height: 25px; display: flex; 
            align-items: center; justify-content: center; opacity: 0.3;
        `;
        btn.onclick = () => {
            const currentKey = localStorage.getItem("API_KEY_FOLDER") || "";
            const newKey = prompt("ระบุ API Key ใหม่:", currentKey);
            if (newKey !== null) {
                localStorage.setItem("API_KEY_FOLDER", newKey.trim());
                alert("บันทึก API Key เรียบร้อยแล้ว! หน้าเว็บจะรีโหลด...");
                location.reload();
            }
        };
        document.body.appendChild(btn);
    }

    // ================= [ UI Notifications & Helpers ] =================
    function showStatusNotify(isSuccess, assetPrefix = "") {
        const existing = document.getElementById('tv-auto-notify');
        if (existing) existing.remove();

        const notify = document.createElement('div');
        notify.id = 'tv-auto-notify';
        notify.style.cssText = `
            position: fixed;
            bottom: 50px;
            right: 20px;
            padding: 3px 8px;
            font-size: 12px;
            z-index: 2147483647;
            pointer-events: none;
            transition: opacity 0.5s ease;
            text-shadow: 0px 1px 2px rgba(0,0,0,0.5);
            border-radius: 4px;
            color: white;
            background: ${isSuccess ? 'rgba(0,100,0,0.8)' : 'rgba(139,0,0,0.8)'};
            font-family: sans-serif;
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        let assetName = assetPrefix === "ES-" ? "S&P 500" : (assetPrefix === "Oil-" ? "OIL" : "GOLD");

        notify.innerHTML = `
            <span style="font-size: 10px;">${isSuccess ? '✅' : '❌'}</span>
            <span>${assetName}</span>
        `;
        document.body.appendChild(notify);

        setTimeout(() => {
            notify.style.opacity = '0';
            setTimeout(() => notify.remove(), 500);
        }, 2000);
    }

    function setColor(el, color) {
        if (!el) return;
        el.style.transition = "background 0.2s";
        el.style.background = color;
    }

    function simulateClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + (rect.width / 2) || 0;
        const cy = rect.top + (rect.height / 2) || 0;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
    }

    function simulateRealisticDoubleClick(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + (rect.width / 2) || 0;
        const cy = rect.top + (rect.height / 2) || 0;
        const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

        // รองรับ Touch Event บน iPad ด้วย
        el.dispatchEvent(new TouchEvent('touchstart', opts));
        el.dispatchEvent(new TouchEvent('touchend', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        setTimeout(() => {
            el.dispatchEvent(new TouchEvent('touchstart', opts));
            el.dispatchEvent(new TouchEvent('touchend', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            el.dispatchEvent(new MouseEvent('dblclick', opts));
        }, 50);
    }

    function findTargetElement() {
        let legendItems = Array.from(document.querySelectorAll('[data-qa-id="legend-source-item"], [class*="sourceItem-"]'));
        for (let item of legendItems) {
            if (TARGET_NAMES.some(name => item.textContent.includes(name))) {
                return item.querySelector('[data-qa-id="title-wrapper legend-source-title"], [class*="mainTitle-"]') || item;
            }
        }
        return null;
    }

    function getAssetPrefix() {
        const titleText = document.title.toUpperCase();
        const legendTitleEl = document.querySelector('[data-qa-id="title-wrapper legend-source-title"]');
        const legendText = legendTitleEl ? legendTitleEl.textContent.toUpperCase() : "";
        const combinedText = `${titleText} ${legendText}`;

        if (titleText.startsWith("ES") || titleText.startsWith("MES") || combinedText.includes("SPX") || combinedText.includes("US500") || combinedText.includes("S&P 500") || combinedText.includes("SP500")) {
            return "ES-";
        }
        if (titleText.startsWith("CL") || titleText.startsWith("WTI") || titleText.startsWith("USOIL") || combinedText.includes("WTI") || combinedText.includes("OIL") || combinedText.includes("USOIL") || combinedText.includes("CRUDE OIL")) {
            return "Oil-";
        }
        if (titleText.startsWith("GC") || titleText.startsWith("MGC") || combinedText.includes("GOLD") || combinedText.includes("XAU")) {
            return "";
        }
        return "";
    }

    // ================= [ Firebase API Fetcher (ปรับใช้ Standard Fetch สำหรับ iPad) ] =================
    async function fetchURL(fileName) {
        const apiKey = getApiKey();
        if (!apiKey) {
            console.error("❌ API Key is missing!");
            return null;
        }

        const safeKey = fileName.replace(/\./g, '_');
        const targetUrl = `${FB_BASE_URL}${apiKey}/${safeKey}.json?_=${Date.now()}`;

        try {
            const response = await fetch(targetUrl, {
                method: 'GET',
                cache: 'no-store'
            });

            if (response.ok) {
                const data = await response.json();
                if (data === null) {
                    console.error(`❌ ไม่พบข้อมูลใน Firebase!`);
                    return null;
                }
                return data;
            } else if (response.status === 401 || response.status === 403) {
                alert("❌ API Key ไม่ถูกต้อง หรือไม่มีสิทธิ์เข้าถึง");
                localStorage.removeItem("API_KEY_FOLDER"); // ล้างรหัส
                return null;
            } else {
                return null;
            }
        } catch (error) {
            console.error("Fetch Error:", error);
            return null;
        }
    }

    async function fetchAll() {
        const prefix = getAssetPrefix();
        const fileIntraday = `${prefix}IntradayData.txt`;
        const fileOI = `${prefix}OIData.txt`;

        const [intraday, oi] = await Promise.all([fetchURL(fileIntraday), fetchURL(fileOI)]);
        return { intraday, oi, prefix };
    }

    // ================= [ TradingView Data Injector ] =================
    function fillReact(el, data) {
        if (!el || !data) return;
        try {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
            setter.call(el, data);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch (e) {
            console.error("Fill Error:", e);
        }
    }

    function findTextareas() {
        const labels = [...document.querySelectorAll("div,span")];
        const textareas = [...document.querySelectorAll("textarea")];
        let taIntraday = null, taOI = null;
        const labelIntraday = labels.find(e => e.textContent.trim().toUpperCase().match(/^(INTRADAY DATA|INTRADAY VOLUME CSV)$/));
        const labelOI = labels.find(e => e.textContent.trim().toUpperCase().match(/^(OI DATA|OI DATA CSV)$/));
        if (labelIntraday) taIntraday = textareas.find(t => labelIntraday.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
        if (labelOI) taOI = textareas.find(t => labelOI.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { taIntraday, taOI };
    }

    async function handleManualMode() {
        const { taIntraday, taOI } = findTextareas();
        if (!taIntraday && !taOI) return;
        const popup = taIntraday?.closest('[role="dialog"]') || taOI?.closest('[role="dialog"]');
        if (!popup || popup === lastPopup || isUpdatingStealth) return;
        lastPopup = popup;

        const currentPrefix = getAssetPrefix();

        if (cachedIntraday || cachedOI) {
            if (taIntraday && cachedIntraday) { fillReact(taIntraday, cachedIntraday); setColor(taIntraday, "#006400"); }
            if (taOI && cachedOI) { fillReact(taOI, cachedOI); setColor(taOI, "#006400"); }
            showStatusNotify(true, currentPrefix);
            setTimeout(() => {
                if (taIntraday) taIntraday.style.background = "";
                if (taOI) taOI.style.background = "";
            }, 2000);
        } else {
            if (taIntraday) setColor(taIntraday, "#6b6b00");
            if (taOI) setColor(taOI, "#6b6b00");
        }

        const data = await fetchAll();

        if (data.intraday !== cachedIntraday || data.oi !== cachedOI) {
            let isSuccess = false;

            if (taIntraday) {
                if (data.intraday) { fillReact(taIntraday, data.intraday); setColor(taIntraday, "#006400"); isSuccess = true; }
                else setColor(taIntraday, "#8B0000");
            }
            if (taOI) {
                if (data.oi) { fillReact(taOI, data.oi); setColor(taOI, "#006400"); isSuccess = true; }
                else setColor(taOI, "#8B0000");
            }

            setTimeout(() => {
                if (taIntraday) taIntraday.style.background = "";
                if (taOI) taOI.style.background = "";
            }, 2000);

            if (isSuccess) {
                cachedIntraday = data.intraday;
                cachedOI = data.oi;
                showStatusNotify(true, data.prefix);
            } else {
                showStatusNotify(false, data.prefix);
            }
        }
    }

    let stealthSafetyTimer = null;
    async function autoUpdateRoutine() {
        if (isUpdatingStealth) return;
        isUpdatingStealth = true;

        clearTimeout(stealthSafetyTimer);
        stealthSafetyTimer = setTimeout(() => { isUpdatingStealth = false; }, 15000);

        const data = await fetchAll();
        if (!data.intraday && !data.oi) {
            showStatusNotify(false, data.prefix);
            isUpdatingStealth = false;
            return;
        }

        if (data.intraday === cachedIntraday && data.oi === cachedOI) {
            showStatusNotify(true, data.prefix);
            isUpdatingStealth = false;
            return;
        }

        const styleId = 'tv-stealth-block-hack';
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.innerHTML = `
            [role="dialog"], [data-dialog-name], .tv-dialog, .js-dialog, div[class*="dialog-"] {
                visibility: hidden !important; opacity: 0 !important; pointer-events: none !important;
                position: fixed !important; top: -9999px !important; left: -9999px !important;
            }
            div[class*="backdrop"], div[class*="overlay"], .js-backdrop, .tv-backdrop, [class*="overlay-"] { display: none !important; }
        `;
        document.head.appendChild(styleEl);

        try {
            let targetEl = findTargetElement();
            if (!targetEl) throw new Error("Target not found");

            simulateRealisticDoubleClick(targetEl);

            let textareasFound = false;
            for (let i = 0; i < 40; i++) {
                const { taIntraday, taOI } = findTextareas();
                if (taIntraday || taOI) {
                    if (taIntraday && data.intraday) fillReact(taIntraday, data.intraday);
                    if (taOI && data.oi) fillReact(taOI, data.oi);
                    textareasFound = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 50));
            }

            if (!textareasFound) throw new Error("Popup inputs not loaded in time");

            await new Promise(r => setTimeout(r, 50));

            const okBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().match(/^(OK|ตกลง)$/i));
            if (okBtn) {
                simulateClick(okBtn);
                cachedIntraday = data.intraday;
                cachedOI = data.oi;
                showStatusNotify(true, data.prefix);
            } else {
                // บน iPad การส่ง Key Event อาจจะไม่ทำงานเสมอไป ใช้การ Click ที่ว่างแทน
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                showStatusNotify(true, data.prefix);
            }

        } catch (e) {
            showStatusNotify(false, data.prefix);
        } finally {
            const s = document.getElementById(styleId);
            if (s) s.remove();
            clearTimeout(stealthSafetyTimer);
            isUpdatingStealth = false;
            lastPopup = null;
        }
    }

    function initializeScript() {
        if (initialLoadComplete) return;

        const hasLegend = document.querySelector('[data-qa-id="legend-source-item"], [class*="sourceItem-"]');
        if (hasLegend) {
            initialLoadComplete = true;
            createResetKeyButton(); // แสดงปุ่มตั้งค่าเมื่อสคริปต์พร้อมทำงาน
            currentSymbolPrefix = getAssetPrefix();
            setTimeout(() => { autoUpdateRoutine(); }, 1500);
            setInterval(autoUpdateRoutine, UPDATE_INTERVAL_MS);
        }
    }

    const triggerManualCheck = () => {
        if (!initialLoadComplete || isUpdatingStealth || isScanningManual) return;

        isScanningManual = true;
        let attempts = 0;
        const scanner = setInterval(() => {
            const { taIntraday, taOI } = findTextareas();
            if (taIntraday || taOI) {
                clearInterval(scanner);
                isScanningManual = false;
                handleManualMode();
                return;
            }
            attempts++;
            if (attempts >= 15) {
                clearInterval(scanner);
                isScanningManual = false;
            }
        }, 200);
    };

    document.addEventListener('click', triggerManualCheck, true);
    document.addEventListener('touchend', triggerManualCheck, true);

    const observer = new MutationObserver(() => {
        if (!initialLoadComplete) initializeScript();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(() => {
        if (!initialLoadComplete) return;

        const currentPrefix = getAssetPrefix();

        if (currentSymbolPrefix !== null && currentPrefix !== currentSymbolPrefix) {
            currentSymbolPrefix = currentPrefix;

            cachedIntraday = null;
            cachedOI = null;

            setTimeout(() => {
                autoUpdateRoutine();
            }, 3500);
        }
    }, 1000);

    setInterval(() => {
        if (lastPopup) {
            if (!document.body.contains(lastPopup) || lastPopup.offsetHeight === 0) {
                lastPopup = null;
            }
        }
    }, 1000);

    setInterval(() => {
        const ads = document.querySelectorAll('#charting-ad, iframe[src*="googlesyndication"], iframe[src*="doubleclick"], div[class*="ad-container"]');
        ads.forEach(ad => {
            const wrapper = ad.closest('[role="log"]') || ad;
            if (wrapper) wrapper.remove();
        });
    }, 500);

})();
