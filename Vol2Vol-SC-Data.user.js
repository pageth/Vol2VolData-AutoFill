// ==UserScript==
// @name         Vol2Vol-SC-Data
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Vol2Vol-SC-Data
// @match        https://cmegroup-sso.quikstrike.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    let FIREBASE_URL = GM_getValue("FIREBASE_URL", "");
    let FIREBASE_SECRET = GM_getValue("FIREBASE_SECRET", "");
    let API_KEY_FOLDER = GM_getValue("API_KEY_FOLDER", "");

    console.log("🚀 CME Vol2Vol Extractor Script Started!");

    function askForCredentials(isError = false) {
        if (isError) {
            alert("⚠️ Firebase แจ้งว่า URL หรือ Secret ผิดพลาด!\nกรุณาตรวจสอบและกรอกข้อมูลใหม่ให้ถูกต้อง");
        }

        let newUrl = prompt("1. กรุณาใส่ FIREBASE_URL\n(ตัวอย่าง: https://my-project.firebaseio.com):", FIREBASE_URL);
        if (newUrl === null) return;

        let newSecret = prompt("2. กรุณาใส่ FIREBASE_SECRET\n(รหัสลับสำหรับเชื่อมต่อฐานข้อมูล):", FIREBASE_SECRET);
        if (newSecret === null) return;

        let newFolder = prompt("3. กรุณาใส่ API_KEY_FOLDER\n(โฟลเดอร์หลัก):", API_KEY_FOLDER);
        if (newFolder === null) return;

        if (newUrl && newSecret && newFolder) {
            FIREBASE_URL = newUrl.trim();
            FIREBASE_SECRET = newSecret.trim();
            API_KEY_FOLDER = newFolder.trim();

            GM_setValue("FIREBASE_URL", FIREBASE_URL);
            GM_setValue("FIREBASE_SECRET", FIREBASE_SECRET);
            GM_setValue("API_KEY_FOLDER", API_KEY_FOLDER);
            
            showNotification("✅ บันทึกการตั้งค่า Firebase เรียบร้อย!");
        } else {
            alert("❌ ข้อมูลไม่ครบถ้วน! ระบบอาจจะไม่สามารถส่งข้อมูลได้");
        }
    }

    GM_registerMenuCommand("⚙️ ตั้งค่า Firebase URL & Secret", () => askForCredentials(false));

    if (!FIREBASE_URL || !FIREBASE_SECRET || FIREBASE_URL.includes("YOUR-PROJECT")) {
        setTimeout(() => askForCredentials(false), 2000);
    }

    function getAssetInfo() {
        const params = new URLSearchParams(window.location.search);
        const pid = params.get('pid');
        
        if (pid == '103') return { prefix: 'ES-', name: 'S&P 500', fallback: 'S&P 500 (ES|ES)' };
        if (pid == '30') return { prefix: 'Oil-', name: 'WTI Crude Oil', fallback: 'WTI Crude Oil (LO|CL)' };
        if (pid == '40') return { prefix: '', name: 'Gold', fallback: 'Gold (OG|GC)' }; 
        
        return { prefix: 'Unknown-', name: 'Unknown Asset', fallback: 'Unknown Asset' };
    }

    function determineCurrentView() {
        const intraBtn = document.querySelector('a[id$="_lbIntradayVolume"]');
        const oiBtn = document.querySelector('a[id$="_lbOI"]');
        
        if (intraBtn && intraBtn.classList.contains('selected')) return 'Intraday';
        if (oiBtn && oiBtn.classList.contains('selected')) return 'OI';

        const headerInfo = document.querySelector('.viewheader-info.left');
        if (headerInfo) {
            const text = headerInfo.innerText.toLowerCase();
            if (text.includes('intraday')) return 'Intraday';
            if (text.includes('open interest') || text.includes('oi')) return 'OI';
        }
        
        return null;
    }

    function getHeaderInfo() {
        const infoEl = document.querySelector('.viewheader-info.left');
        const subEl = document.querySelector('.highcharts-subtitle');
        return {
            info: infoEl ? infoEl.innerText.trim() : "N/A",
            subtitle: subEl ? subEl.textContent.trim() : "N/A"
        };
    }

    function extractChartData() {
        const hc = (typeof unsafeWindow !== 'undefined' ? unsafeWindow.Highcharts : window.Highcharts);
        if (!hc || !hc.charts) return null;
        
        const chart = hc.charts.find(c => c && c.series && c.series.some(s => s.name === "Put"));
        if (!chart) return null;

        const map = {};
        chart.series.forEach(s => {
            const n = s.name.trim();
            const f = n === "Put" ? "put" : (n === "Call" ? "call" : (n === "Vol Settle" ? "volSettle" : ""));
            
            if (f) {
                (s.points || s.data || []).forEach(p => {
                    const k = p.category || p.x;
                    if (!map[k]) map[k] = { strike: k, put: 0, call: 0, volSettle: 0 };
                    map[k][f] = p.y;
                });
            }
        });
        
        return Object.values(map).sort((a, b) => Number(a.strike) - Number(b.strike));
    }

    function formatToText(rows, infoTitle) {
        var lines = [];
        if (infoTitle) lines.push(infoTitle);
        lines.push("Strike,Call,Put,Vol Settle");
        
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            lines.push([
                r.strike != null ? r.strike : "",
                r.call != null ? r.call : "0",
                r.put != null ? r.put : "0",
                r.volSettle != null ? r.volSettle : "0"
            ].join(","));
        }
        return lines.join("\n");
    }

    function showNotification(msg) {
        let toast = document.createElement('div');
        toast.innerText = msg;
        toast.style.cssText = "position:fixed; bottom:20px; right:20px; background:#333; color:#fff; padding:10px 20px; border-radius:5px; z-index:99999; font-family:sans-serif; box-shadow: 0 4px 6px rgba(0,0,0,0.3); font-size:14px;";
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
    
    function uploadToFirebase(filename, content) {
        if (!FIREBASE_URL || !FIREBASE_SECRET) {
            askForCredentials(false);
            return;
        }

        const safeKey = filename.replace(/\./g, '_');
        const url = `${FIREBASE_URL.replace(/\/$/, '')}/${API_KEY_FOLDER}/${safeKey}.json?auth=${FIREBASE_SECRET}&print=silent`;

        GM_xmlhttpRequest({
            method: "PUT",
            url: url,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify(content),
            onload: function(response) {
                if (response.status >= 200 && response.status < 300) {
                    console.log(`✅ อัปโหลด [${filename}] สำเร็จ!`);
                    showNotification(`✅ อัปเดต ${filename} สำเร็จ`);
                } else if (response.status === 401 || response.status === 400 || response.status === 404) {
                    console.error(`❌ Firebase Error:`, response.responseText);
                    askForCredentials(true); 
                } else {
                    console.error(`❌ Upload Error:`, response.responseText);
                    showNotification(`❌ อัปโหลดพลาด (Status: ${response.status})`);
                }
            },
            onerror: function(err) {
                console.error(`❌ Network Error:`, err);
                showNotification(`❌ ไม่สามารถเชื่อมต่อ Firebase ได้`);
            }
        });
    }

    function processAndUpload(type) {
        let attempts = 0;
        const maxAttempts = 5; 
        const asset = getAssetInfo(); 

        function tryExtract() {
            attempts++;
            const header = getHeaderInfo();
            const chartData = extractChartData();
            const filename = `${asset.prefix}${type}Data.txt`; 

            if (!chartData || chartData.length === 0) {
                if (attempts < maxAttempts) {
                    console.log(`⏳ กราฟ ${type} ยังไม่โหลด รออีก 2 วิ... (ครั้งที่ ${attempts}/${maxAttempts})`);
                    setTimeout(tryExtract, 2000); 
                } else {
                    console.warn(`⚠️ ไม่สามารถดึงกราฟ ${type} ได้ กำลังส่งข้อมูลสำรองแทน...`);
                    showNotification(`⚠️ ดึงข้อมูลไม่ได้ ส่ง "${asset.fallback}" แทน`);
                    uploadToFirebase(filename, asset.fallback);
                }
                return;
            }

            const textContent = formatToText(chartData, header.info + "\n" + header.subtitle);
            console.log(`📊 ดึงข้อมูล ${asset.name} (${type}) สำเร็จ ส่งขึ้น Firebase...`);
            uploadToFirebase(filename, textContent);
        }

        setTimeout(tryExtract, 3500);
    }

    document.addEventListener('pointerdown', function(e) {
        if (e.target.id === 'refreshButton' || e.target.closest('#refreshButton')) {
            const currentView = determineCurrentView();
            const asset = getAssetInfo();
            
            if (currentView) {
                showNotification(`🔄 รีเฟรช: รออ่านข้อมูล ${asset.name} (${currentView})...`);
                processAndUpload(currentView);
            } else {
                showNotification(`❌ ไม่สามารถระบุได้ว่าหน้าปัจจุบันคือ Intraday หรือ OI`);
            }
            return; 
        }

        const target = e.target.closest('a');
        if (!target) return;

        const asset = getAssetInfo();

        if (target.id && target.id.endsWith('_lbIntradayVolume')) {
            showNotification(`⏳ กำลังรออ่านข้อมูล ${asset.name} (Intraday)...`);
            processAndUpload('Intraday');
        } 
        else if (target.id && target.id.endsWith('_lbOI')) {
            showNotification(`⏳ กำลังรออ่านข้อมูล ${asset.name} (OI)...`);
            processAndUpload('OI');
        }
    });

})();
