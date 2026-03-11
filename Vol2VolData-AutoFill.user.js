// ==UserScript==
// @name         Vol2VolData AutoFill
// @namespace    https://github.com/pageth
// @version      1.0
// @description  Auto fill Intraday & OI Data
// @author       filmworachai
// @match        https://*.tradingview.com/chart/*
// @icon         https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/refs/heads/main/tradingview.ico
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @downloadURL  https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill.user.js
// @updateURL    https://raw.githubusercontent.com/pageth/Vol2VolData-AutoFill/main/Vol2VolData-AutoFill.user.js
// ==/UserScript==

(function () {
"use strict";

const URL_INTRADAY = "https://raw.githubusercontent.com/pageth/Vol2VolData/main/IntradayData.txt";
const URL_OI       = "https://raw.githubusercontent.com/pageth/Vol2VolData/main/OIData.txt";

let lastPopup = null;

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
    const [intraday, oi] = await Promise.all([
        fetchURL(URL_INTRADAY),
        fetchURL(URL_OI)
    ]);
    return { intraday, oi };
}

function fillReact(el, data) {
    if (!el || !data) return;

    const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, "value"
    ).set;

    setter.call(el, data);

    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setColor(el, color) {
    if (!el) return;
    el.style.transition = "background 0.2s";
    el.style.background = color;
}

function findTextareas() {

    const labels = [...document.querySelectorAll("div,span")];
    const textareas = [...document.querySelectorAll("textarea")];

    let taIntraday = null;
    let taOI = null;

    const labelIntraday = labels.find(e => {
        const t = e.textContent.trim().toUpperCase();
        return t === "INTRADAY DATA" || t === "INTRADAY VOLUME CSV";
    });

    const labelOI = labels.find(e => {
        const t = e.textContent.trim().toUpperCase();
        return t === "OI DATA" || t === "OI DATA CSV";
    });

    if (labelIntraday) {
        taIntraday = textareas.find(t =>
            labelIntraday.compareDocumentPosition(t) &
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    }

    if (labelOI) {
        taOI = textareas.find(t =>
            labelOI.compareDocumentPosition(t) &
            Node.DOCUMENT_POSITION_FOLLOWING
        );
    }

    return { taIntraday, taOI };
}

async function runAutofill() {

    const { taIntraday, taOI } = findTextareas();
    if (!taIntraday && !taOI) return;

    const popup = taIntraday?.closest('[role="dialog"]')
        || taOI?.closest('[role="dialog"]');

    if (!popup || popup === lastPopup) return;

    lastPopup = popup;

    console.log("Autofill");

    setColor(taIntraday, "#6b6b00");
    setColor(taOI, "#6b6b00");

    const data = await fetchAll();

    if (taIntraday) {
        if (data.intraday) {
            fillReact(taIntraday, data.intraday);
            setColor(taIntraday, "#006400");
            console.log("Intraday OK");
        } else {
            setColor(taIntraday, "#8B0000");
            console.log("Intraday FAIL");
        }
        setTimeout(() => taIntraday.style.background = "", 2000);
    }

    if (taOI) {
        if (data.oi) {
            fillReact(taOI, data.oi);
            setColor(taOI, "#006400");
            console.log("OI OK");
        } else {
            setColor(taOI, "#8B0000");
            console.log("OI FAIL");
        }
        setTimeout(() => taOI.style.background = "", 2000);
    }
}

const observer = new MutationObserver(() => runAutofill());

observer.observe(document.body, {
    childList: true,
    subtree: true
});

console.log("Vol2Vol AutoFill loaded");

})();
