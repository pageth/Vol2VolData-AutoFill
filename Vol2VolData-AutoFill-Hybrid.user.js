// ==UserScript==
// @name         Vol2VolData AutoFill (Hybrid)
// @namespace    https://github.com/pageth
// @version      2.9
// @description  Auto fill Intraday & OI Data with Auto-Detect Asset
// @author       filmworachai
// @match        https://*.tradingview.com/chart/*
// @icon         https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/refs/heads/main/tradingview.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      pageth.github.io
// @downloadURL  https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill-Hybrid.user.js
// @updateURL    https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill-Hybrid.user.js
// ==/UserScript==

(function () {
    "use strict";

    const TARGET_NAMES = ['Round Numbers', 'Gamma Options', 'Vol2Vol']; 
    const BASE_URL = "https://pageth.github.io/Vol2VolData/";
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
        div[class*="tv-floating-toolbar"],
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
    `;

    if (typeof GM_addStyle !== "undefined") {
        GM_addStyle(cssHideAds);
    } else {
        const styleEl = document.createElement('style');
        styleEl.innerHTML = cssHideAds;
        document.head.appendChild(styleEl);
    }

    function showStatusNotify(isSuccess, assetPrefix = "") {
        const existing = document.getElementById('tv-auto-notify');
        if (existing) existing.remove();

        const notify = document.createElement('div');
        notify.id = 'tv-auto-notify';
        notify.style.cssText = `
            position: fixed;
            bottom: 20px;
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
        
        el.dispatchEvent(new MouseEvent('mouseenter', opts));
        el.dispatchEvent(new MouseEvent('mouseover', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        el.dispatchEvent(new MouseEvent('dblclick', opts));
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

    function fetchURL(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url + "?t=" + Date.now(),
                nocache: true,
                headers: {
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                },
                onload: r => resolve(r.status === 200 ? r.responseText : null),
                onerror: () => resolve(null)
            });
        });
    }

    async function fetchAll() {
        const prefix = getAssetPrefix();
        const urlIntraday = `${BASE_URL}${prefix}IntradayData.txt`;
        const urlOI = `${BASE_URL}${prefix}OIData.txt`;

        const [intraday, oi] = await Promise.all([fetchURL(urlIntraday), fetchURL(urlOI)]);
        return { intraday, oi, prefix };
    }

    function fillReact(el, data) {
        if (!el || !data) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(el, data);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
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

    async function autoUpdateRoutine() {
        if (isUpdatingStealth) return;
        isUpdatingStealth = true;

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
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                showStatusNotify(true, data.prefix);
            }

        } catch (e) {
            showStatusNotify(false, data.prefix);
        } finally {
            const s = document.getElementById(styleId);
            if (s) s.remove();
            isUpdatingStealth = false;
            lastPopup = null;
        }
    }

    function initializeScript() {
        if (initialLoadComplete) return;

        const hasLegend = document.querySelector('[data-qa-id="legend-source-item"], [class*="sourceItem-"]');
        if (hasLegend) {
            initialLoadComplete = true;
            currentSymbolPrefix = getAssetPrefix(); 
            setTimeout(() => { autoUpdateRoutine(); }, 1000); 
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

    const observer = new MutationObserver((mutations) => {
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
            
            autoUpdateRoutine();
        }
    }, 1000);

    setInterval(() => {
        if (lastPopup && !document.body.contains(lastPopup)) {
            lastPopup = null;
        }
    }, 1000);

    setInterval(() => {
        const ads = document.querySelectorAll('#charting-ad, iframe[src*="googlesyndication"], iframe[src*="doubleclick"], div[class*="ad-container"]');
        ads.forEach(ad => {
            const wrapper = ad.closest('[role="log"], .tv-floating-toolbar') || ad;
            if (wrapper) wrapper.remove();
        });
    }, 500);

})();
