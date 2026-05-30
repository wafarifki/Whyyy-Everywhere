(() => {
    "use strict";

    const STORAGE_KEY = "WhyyyEverywhereSettings";
    const DEFAULT_SETTINGS = {
        enabled: false,
        mode: "single",
        selected: "prabowo",
    };

    const IMAGE_OPTIONS = [
        { id: "prabowo", label: "Prabowo", path: "images/replacements/prabowo.png" },
        { id: "jokowi", label: "Jokowi", path: "images/replacements/jokowi.jpg" },
        { id: "megawati", label: "Megawati", path: "images/replacements/megawati.jpg" },
        { id: "soeharto", label: "Soeharto", path: "images/replacements/soeharto.jpg" },
    ];

    const REPLACEMENT_IMAGES = IMAGE_OPTIONS.map((item) => ({
        ...item,
        url: chrome.runtime.getURL(item.path),
    }));

    const IMAGE_BY_ID = new Map(REPLACEMENT_IMAGES.map((item) => [item.id, item]));
    const XLINK_NS = "http://www.w3.org/1999/xlink";

    const ATTRS_TO_WATCH = [
        "src",
        "srcset",
        "href",
        "xlink:href",
        "style",
        "class",
        "data-src",
        "data-srcset",
        "data-original",
        "data-lazy-src",
        "data-bg",
        "data-background",
        "data-bg-src",
    ];

    const LAZY_IMAGE_ATTRS = ["data-src", "data-original", "data-lazy-src", "data-srcset"];

    const LAZY_BACKGROUND_ATTRS = ["data-bg", "data-background", "data-bg-src"];

    const observedRoots = new WeakSet();
    const allModeAssignments = new WeakMap();

    let settings = { ...DEFAULT_SETTINGS };
    let started = false;
    let scheduledFullScan = false;
    let allModeIndex = 0;

    function normalizeSettings(value) {
        const raw = value && typeof value === "object" ? value : {};
        const selected = IMAGE_BY_ID.has(raw.selected) ? raw.selected : DEFAULT_SETTINGS.selected;
        const mode = raw.mode === "all" ? "all" : "single";

        return {
            enabled: Boolean(raw.enabled),
            mode,
            selected,
        };
    }

    function loadSettings(callback) {
        try {
            chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (result) => {
                if (chrome.runtime.lastError) {
                    settings = { ...DEFAULT_SETTINGS };
                } else {
                    settings = normalizeSettings(result[STORAGE_KEY]);
                }
                callback();
            });
        } catch (_) {
            settings = { ...DEFAULT_SETTINGS };
            callback();
        }
    }

    function getActiveImages() {
        if (!settings.enabled) return [];

        if (settings.mode === "all") {
            return REPLACEMENT_IMAGES.map((item) => item.url);
        }

        const item = IMAGE_BY_ID.get(settings.selected) || IMAGE_BY_ID.get(DEFAULT_SETTINGS.selected);
        return [item.url];
    }

    function getReplacementImage(element) {
        const activeImages = getActiveImages();
        if (!activeImages.length) return "";
        if (activeImages.length === 1) return activeImages[0];

        if (element && allModeAssignments.has(element)) {
            const assigned = allModeAssignments.get(element);
            if (activeImages.includes(assigned)) return assigned;
        }

        const nextImage = activeImages[allModeIndex % activeImages.length];
        allModeIndex += 1;

        if (element) {
            allModeAssignments.set(element, nextImage);
        }

        return nextImage;
    }

    function cssUrl(url) {
        return 'url("' + String(url).replace(/["\\]/g, "\\$&") + '")';
    }

    function replaceCssUrls(value, element) {
        if (!settings.enabled || !value || value === "none" || !/url\(/i.test(value)) {
            return value;
        }

        return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, () => cssUrl(getReplacementImage(element)));
    }

    function setAttributeIfDifferent(element, attribute, value) {
        if (!settings.enabled || !value) return;

        try {
            if (element.getAttribute(attribute) !== value) {
                element.setAttribute(attribute, value);
            }
        } catch (_) {
            // Beberapa atribut mungkin tidak bisa di-set di beberapa elemen atau browser, jadi kita diemin aja kalo error.
        }
    }

    function setPropertyIfDifferent(element, property, value) {
        if (!settings.enabled || !value) return;

        try {
            if (property in element && element[property] !== value) {
                element[property] = value;
            }
        } catch (_) {
            // Diemin aja kalo ada error saat set property, beberapa property bisa jadi read-only di beberapa elemen atau browser.
        }
    }

    function replaceImgElement(element) {
        const replacement = getReplacementImage(element);
        setAttributeIfDifferent(element, "src", replacement);
        setAttributeIfDifferent(element, "srcset", replacement);
        setPropertyIfDifferent(element, "src", replacement);
        setPropertyIfDifferent(element, "srcset", replacement);

        for (const attribute of LAZY_IMAGE_ATTRS) {
            if (element.hasAttribute(attribute)) {
                setAttributeIfDifferent(element, attribute, replacement);
            }
        }
    }

    function replaceSourceElement(element) {
        const replacement = getReplacementImage(element);

        if (element.hasAttribute("srcset")) {
            setAttributeIfDifferent(element, "srcset", replacement);
            setPropertyIfDifferent(element, "srcset", replacement);
        }

        if (element.hasAttribute("data-srcset")) {
            setAttributeIfDifferent(element, "data-srcset", replacement);
        }
    }

    function replaceInputImageElement(element) {
        const type = (element.getAttribute("type") || "").toLowerCase();
        if (type === "image") {
            const replacement = getReplacementImage(element);
            setAttributeIfDifferent(element, "src", replacement);
            setPropertyIfDifferent(element, "src", replacement);
        }
    }

    function replaceSvgImageElement(element) {
        const replacement = getReplacementImage(element);
        setAttributeIfDifferent(element, "href", replacement);

        try {
            if (element.getAttributeNS(XLINK_NS, "href") !== replacement) {
                element.setAttributeNS(XLINK_NS, "href", replacement);
            }
        } catch (_) {
            // diemin kalo gaada xlink nya
        }
    }

    function replaceBackgroundImage(element) {
        if (!settings.enabled || !element || !element.style || typeof window.getComputedStyle !== "function") {
            return;
        }

        try {
            const computedBackground = window.getComputedStyle(element).backgroundImage;
            const replacedBackground = replaceCssUrls(computedBackground, element);

            if (replacedBackground !== computedBackground) {
                element.style.setProperty("background-image", replacedBackground, "important");
            }

            const replacement = getReplacementImage(element);
            for (const attribute of LAZY_BACKGROUND_ATTRS) {
                if (element.hasAttribute(attribute)) {
                    setAttributeIfDifferent(element, attribute, replacement);
                }
            }
        } catch (_) {
            // Console log harusnya disini, tapi beberapa elemen bisa bikin error saat diakses stylenya, jadi kita diemin aja.
        }
    }

    function processElement(element) {
        if (!settings.enabled || !element || element.nodeType !== Node.ELEMENT_NODE) return;

        const tagName = (element.localName || "").toLowerCase();

        if (tagName === "img") {
            replaceImgElement(element);
        } else if (tagName === "source") {
            replaceSourceElement(element);
        } else if (tagName === "input") {
            replaceInputImageElement(element);
        } else if (tagName === "image") {
            replaceSvgImageElement(element);
        }

        replaceBackgroundImage(element);

        if (element.shadowRoot) {
            observeRoot(element.shadowRoot);
            processTree(element.shadowRoot);
        }
    }

    function processTree(root) {
        if (!settings.enabled || !root) return;

        if (root.nodeType === Node.ELEMENT_NODE) {
            processElement(root);
        }

        if (typeof root.querySelectorAll === "function") {
            for (const element of root.querySelectorAll("*")) {
                processElement(element);
            }
        }
    }

    function scheduleFullScan() {
        if (!settings.enabled || scheduledFullScan) return;
        scheduledFullScan = true;

        const run = () => {
            scheduledFullScan = false;
            processTree(document);
        };

        if (typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(run);
        } else {
            window.setTimeout(run, 50);
        }
    }

    function handleMutations(mutations) {
        if (!settings.enabled) return;

        let shouldScanAgain = false;

        for (const mutation of mutations) {
            if (mutation.type === "childList") {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                        processTree(node);
                        shouldScanAgain = true;
                    }
                }
            } else if (mutation.type === "attributes") {
                processElement(mutation.target);
                shouldScanAgain = true;
            }
        }

        if (shouldScanAgain) {
            scheduleFullScan();
        }
    }

    function observeRoot(root) {
        if (!root || observedRoots.has(root)) return;

        try {
            const observer = new MutationObserver(handleMutations);
            observer.observe(root, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ATTRS_TO_WATCH,
            });
            observedRoots.add(root);
        } catch (_) {
            // diemin aja kalo ga bisa observe, mungkin karena rootnya bukan element atau document fragment, atau karena keterbatasan browser di halaman tertentu.
        }
    }

    function startReplacing() {
        if (!settings.enabled) return;

        if (started) {
            scheduleFullScan();
            return;
        }

        started = true;
        observeRoot(document);
        processTree(document);

        document.addEventListener(
            "DOMContentLoaded",
            () => {
                processTree(document);
                observeRoot(document.documentElement || document);
            },
            { once: true }
        );

        window.addEventListener(
            "load",
            () => {
                processTree(document);
                window.setTimeout(() => processTree(document), 500);
                window.setTimeout(() => processTree(document), 1500);
            },
            { once: true }
        );

        const earlyScan = window.setInterval(() => processTree(document), 750);
        window.setTimeout(() => window.clearInterval(earlyScan), 10000);
    }

    loadSettings(startReplacing);

    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== "local" || !changes[STORAGE_KEY]) return;
            settings = normalizeSettings(changes[STORAGE_KEY].newValue);
            if (settings.enabled) {
                startReplacing();
                scheduleFullScan();
            }
        });
    } catch (_) {
        // diemin aja kalo ada error di storage listener, mungkin di halaman yang dibatasi.
    }
})();