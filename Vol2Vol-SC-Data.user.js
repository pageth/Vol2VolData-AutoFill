// ==UserScript==
// @name         Vol2Vol-SC-Data
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Vol2Vol-SC-Data
// @match        https://cmegroup-sso.quikstrike.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

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
        } else {
            alert("❌ ข้อมูลไม่ครบถ้วน! ระบบอาจจะไม่สามารถส่งข้อมูลได้");
        }
    }

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand("⚙️ ตั้งค่า Firebase URL & Secret", () => askForCredentials(false));
    }

    if (!FIREBASE_URL || !FIREBASE_SECRET || FIREBASE_URL.includes("YOUR-PROJECT")) {
        setTimeout(() => askForCredentials(false), 2000);
    }

    function getAssetInfo() {
        const params = new URLSearchParams(window.location.search);
        const pid = params.get('pid');
        
        if (pid == '103') return { prefix: 'ES-', name: 'S&P 500', fallback: 'S&P 500 (ES|ES)', isValid: true };
        if (pid == '30') return { prefix: 'Oil-', name: 'WTI Crude Oil', fallback: 'WTI Crude Oil (LO|CL)', isValid: true };
        if (pid == '40') return { prefix: '', name: 'Gold', fallback: 'Gold (OG|GC)', isValid: true }; 
        
        return { prefix: 'Unknown-', name: 'Unknown Asset', fallback: 'Unknown Asset', isValid: false };
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

    function extractChartDataAsync() {
        return new Promise((resolve) => {
            const eventId = "ExtractHC_" + Date.now();
            
            window.addEventListener(eventId, function(e) {
                resolve(e.detail);
            }, { once: true });

            const script = document.createElement('script');
            script.textContent = `
                (function() {
                    try {
                        const hc = window.Highcharts;
                        if (!hc || !hc.charts) { window.dispatchEvent(new CustomEvent('${eventId}', { detail: null })); return; }
                        
                        const chart = hc.charts.find(c => c && c.series && c.series.some(s => s.name === "Put"));
                        if (!chart) { window.dispatchEvent(new CustomEvent('${eventId}', { detail: null })); return; }

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
                        
                        const result = Object.values(map).sort((a, b) => Number(a.strike) - Number(b.strike));
                        window.dispatchEvent(new CustomEvent('${eventId}', { detail: result }));
                    } catch(err) {
                        window.dispatchEvent(new CustomEvent('${eventId}', { detail: null }));
                    }
                })();
            `;
            document.body.appendChild(script);
            setTimeout(() => script.remove(), 1000);
        });
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
                    showNotification(`✅ อัปเดต ${filename} สำเร็จ`);
                } else if (response.status === 401 || response.status === 400 || response.status === 404) {
                    askForCredentials(true); 
                } else {
                    showNotification(`❌ อัปโหลดพลาด (Status: ${response.status})`);
                }
            },
            onerror: function(err) {
                showNotification(`❌ ไม่สามารถเชื่อมต่อ Firebase ได้`);
            }
        });
    }

    function processAndUpload(type) {
        const asset = getAssetInfo(); 
        if (!asset.isValid) return;

        let attempts = 0;
        const maxAttempts = 5; 

        async function tryExtract() {
            attempts++;
            const header = getHeaderInfo();
            const chartData = await extractChartDataAsync();
            const filename = `${asset.prefix}${type}Data.txt`; 

            if (!chartData || chartData.length === 0) {
                if (attempts < maxAttempts) {
                    setTimeout(tryExtract, 2000); 
                } else {
                    showNotification(`⚠️ ดึงข้อมูลไม่ได้ ส่ง "${asset.fallback}" แทน`);
                    uploadToFirebase(filename, asset.fallback);
                }
                return;
            }

            const textContent = formatToText(chartData, header.info + "\n" + header.subtitle);
            uploadToFirebase(filename, textContent);
        }

        setTimeout(tryExtract, 3500);
    }

    ['click', 'touchend'].forEach(evt => {
        document.addEventListener(evt, function(e) {
            
            if (e.target.id === 'refreshButton' || e.target.closest('#refreshButton')) {
                const asset = getAssetInfo();
                if (!asset.isValid) return; 

                const currentView = determineCurrentView();
                if (currentView) {
                    showNotification(`🔄 รีเฟรช: รออ่านข้อมูล...`);
                    processAndUpload(currentView);
                }
                return; 
            }

            const target = e.target.closest('a');
            if (!target) return;

            const asset = getAssetInfo();
            if (!asset.isValid) return; 

            if (target.id && target.id.endsWith('_lbChurn')) {
                showNotification(`🔄 ส่งข้อมูล Churn (Fallback) สำหรับ ${asset.name}...`);
                uploadToFirebase(`${asset.prefix}IntradayData.txt`, asset.fallback);
                uploadToFirebase(`${asset.prefix}OIData.txt`, asset.fallback);
            }
            else if (target.id && target.id.endsWith('_lbIntradayVolume')) {
                showNotification(`⏳ กำลังรออ่านข้อมูล ${asset.name} (Intraday)...`);
                processAndUpload('Intraday');
            } 
            else if (target.id && target.id.endsWith('_lbOI')) {
                showNotification(`⏳ กำลังรออ่านข้อมูล ${asset.name} (OI)...`);
                processAndUpload('OI');
            }
        });
    });

})();
