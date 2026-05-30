(() => {
    "use strict";

    const STORAGE_KEY = "WhyyyEverywhereSettings";
    const DEFAULT_SETTINGS = {
        enabled: false,
        mode: "single",
        selected: "prabowo",
    };

    const LABELS = {
        prabowo: "Prabowo",
        jokowi: "Jokowi",
        megawati: "Megawati",
        soeharto: "Soeharto",
    };

    const powerToggle = document.getElementById("powerToggle");
    const statusDot = document.getElementById("statusDot");
    const stateLabel = document.getElementById("stateLabel");
    const modeLabel = document.getElementById("modeLabel");
    const allButton = document.getElementById("allButton");
    const choiceButtons = Array.from(document.querySelectorAll(".choice-card"));

    let settings = { ...DEFAULT_SETTINGS };
    let isSaving = false;

    function normalizeSettings(value) {
        const raw = value && typeof value === "object" ? value : {};
        const selected = Object.prototype.hasOwnProperty.call(LABELS, raw.selected)
            ? raw.selected
            : DEFAULT_SETTINGS.selected;

        return {
            enabled: Boolean(raw.enabled),
            mode: raw.mode === "all" ? "all" : "single",
            selected,
        };
    }

    function render() {
        powerToggle.checked = settings.enabled;
        statusDot.classList.toggle("on", settings.enabled);
        stateLabel.textContent = settings.enabled ? "ON" : "OFF";

        if (!settings.enabled) {
            modeLabel.textContent = "Fitur mati. Website akan normal setelah reload.";
        } else if (settings.mode === "all") {
            modeLabel.textContent = "Mode Semua Aktif: gambar diganti bergantian.";
        } else {
            modeLabel.textContent = `Mode Aktif: ${LABELS[settings.selected]}.`;
        }

        choiceButtons.forEach((button) => {
            const choice = button.dataset.choice;
            button.classList.toggle(
                "active",
                settings.enabled && settings.mode === "single" && settings.selected === choice
            );
        });

        allButton.classList.toggle("active", settings.enabled && settings.mode === "all");
    }

    function reloadActiveTab() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError || !tabs || !tabs[0] || typeof tabs[0].id !== "number") {
                return;
            }

            chrome.tabs.reload(tabs[0].id, {}, () => {
                if (chrome.runtime.lastError) {
                    return;
                }
            });
        });
    }

    function save(nextSettings) {
        if (isSaving) return;

        isSaving = true;
        settings = normalizeSettings(nextSettings);
        render();

        chrome.storage.local.set({ [STORAGE_KEY]: settings }, () => {
            isSaving = false;

            if (chrome.runtime.lastError) {
                return;
            }

            reloadActiveTab();
        });
    }

    function load() {
        chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (result) => {
            if (chrome.runtime.lastError) {
                settings = { ...DEFAULT_SETTINGS };
            } else {
                settings = normalizeSettings(result[STORAGE_KEY]);
            }

            render();
        });
    }

    powerToggle.addEventListener("change", () => {
        save({
            ...settings,
            enabled: powerToggle.checked,
        });
    });

    choiceButtons.forEach((button) => {
        button.addEventListener("click", () => {
            save({
                enabled: true,
                mode: "single",
                selected: button.dataset.choice,
            });
        });
    });

    allButton.addEventListener("click", () => {
        save({
            ...settings,
            enabled: true,
            mode: "all",
        });
    });

    load();
})();