// ==UserScript==
// @name         Vol2VolData AutoFill (Hybrid)
// @namespace    https://github.com/pageth
// @version      1.0
// @description  Auto fill Intraday & OI Data (Hybrid)
// @author       filmworachai
// @match        https://*.tradingview.com/chart/*
// @icon         https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/refs/heads/main/tradingview.ico
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill-Hybrid.user.js
// @updateURL    https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill-Hybrid.user.js
// ==/UserScript==

(function () {
    "use strict";

    const URL_INTRADAY = "https://raw.githubusercontent.com/pageth/Vol2VolData/main/IntradayData.txt";
    const URL_OI       = "https://raw.githubusercontent.com/pageth/Vol2VolData/main/OIData.txt";
    const UPDATE_INTERVAL_MS = 100000;
    const TABLE_OFFSET_X = 200;
    const TABLE_OFFSET_Y = 300;

    let lastPopup = null;
    let isUpdatingStealth = false;

    // --- MINIMAL NOTIFICATION ---
    function showStatusNotify(isSuccess) {
        const notify = document.createElement('div');
        notify.style.cssText = `
            position: fixed;
            bottom: 10px;
            right: 10px;
            padding: 5px;
            font-size: 20px;
            z-index: 10000;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;
        notify.innerHTML = isSuccess ? '✅' : '❌';
        document.body.appendChild(notify);

        // แสดงเพียง 1 วินาทีแล้วหายไป
        setTimeout(() => {
            notify.style.opacity = '0';
            setTimeout(() => notify.remove(), 300);
        }, 1000);
    }

    // --- HELPER FUNCTIONS ---
    function setColor(el, color) {
        if (!el) return;
        el.style.transition = "background 0.2s";
        el.style.background = color;
    }

    function clearTooltip(target, x, y) {
        const outOptions = { clientX: x, clientY: y, bubbles: true };
        target.dispatchEvent(new MouseEvent('mouseleave', outOptions));
        target.dispatchEvent(new MouseEvent('mouseout', outOptions));
        document.body.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, bubbles: true }));
    }

    function fetchURL(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url + "?t=" + Date.now(),
                onload: r => resolve(r.status === 200 ? r.responseText : null),
                onerror: () => resolve(null)
            });
        });
    }

    async function fetchAll() {
        const [intraday, oi] = await Promise.all([fetchURL(URL_INTRADAY), fetchURL(URL_OI)]);
        return { intraday, oi };
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

    // --- MODE 1: MANUAL DETECTOR ---
    async function handleManualMode() {
        const { taIntraday, taOI } = findTextareas();
        if (!taIntraday && !taOI) return;
        const popup = taIntraday?.closest('[role="dialog"]') || taOI?.closest('[role="dialog"]');
        if (!popup || popup === lastPopup || isUpdatingStealth) return;
        lastPopup = popup;

        if (taIntraday) setColor(taIntraday, "#6b6b00");
        if (taOI) setColor(taOI, "#6b6b00");

        const data = await fetchAll();

        if (taIntraday) {
            if (data.intraday) { fillReact(taIntraday, data.intraday); setColor(taIntraday, "#006400"); }
            else setColor(taIntraday, "#8B0000");
            setTimeout(() => taIntraday.style.background = "", 2000);
        }
        if (taOI) {
            if (data.oi) { fillReact(taOI, data.oi); setColor(taOI, "#006400"); }
            else setColor(taOI, "#8B0000");
            setTimeout(() => taOI.style.background = "", 2000);
        }
    }

    // --- MODE 2: STEALTH AUTO-UPDATE ---
    async function autoUpdateRoutine() {
        if (isUpdatingStealth) return;
        isUpdatingStealth = true;

        const data = await fetchAll();
        if (!data.intraday && !data.oi) {
            showStatusNotify(false);
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
            const clickX = window.innerWidth - TABLE_OFFSET_X;
            const clickY = TABLE_OFFSET_Y;
            const target = document.elementFromPoint(clickX, clickY) || document.body;
            const eventOptions = { clientX: clickX, clientY: clickY, bubbles: true, cancelable: true };

            target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
            target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
            target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
            target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
            target.dispatchEvent(new MouseEvent('dblclick', eventOptions));

            clearTooltip(target, clickX, clickY);

            await new Promise(r => setTimeout(r, 1500));

            const { taIntraday, taOI } = findTextareas();
            if (taIntraday && data.intraday) fillReact(taIntraday, data.intraday);
            if (taOI && data.oi) fillReact(taOI, data.oi);

            await new Promise(r => setTimeout(r, 500));

            const okBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().match(/^(OK|ตกลง)$/i));
            if (okBtn) {
                okBtn.click();
                showStatusNotify(true);
            } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                showStatusNotify(true);
            }

        } catch (e) {
            showStatusNotify(false);
        } finally {
            setTimeout(() => {
                const s = document.getElementById(styleId);
                if (s) s.remove();
                isUpdatingStealth = false;
                lastPopup = null;
            }, 1000);
        }
    }

    // --- MAIN OBSERVER & TIMERS ---
    const observer = new MutationObserver(() => handleManualMode());
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        autoUpdateRoutine();
        setInterval(autoUpdateRoutine, UPDATE_INTERVAL_MS);
    }, 5000);

    setInterval(() => {
        const adBox = document.querySelector('[id="charting-ad"]');
        if (adBox) {
            adBox.closest('[role="log"]')?.remove();
        }
    }, 100);

})();
