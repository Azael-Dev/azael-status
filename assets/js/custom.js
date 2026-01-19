(() => {
    let rangeInitialized = false;

    // Set current year in footer
    const setFooterYear = () => {
        const el = document.getElementById('footer-year');
        if (!el) return false;

        el.textContent = new Date().getFullYear();
        return true;
    };

    // Set default time range to 30 days (run once)
    const setDefault30Days = () => {
        if (rangeInitialized) return true;

        const btn30 = document.getElementById('data_30');
        if (!btn30) return false;

        if (!btn30.checked) {
            rangeInitialized = true;
            btn30.click();
        } else {
            rangeInitialized = true;
        }

        return true;
    };

    const tryInit = () => {
        const yearOk = setFooterYear();
        const rangeOk = setDefault30Days();

        return yearOk && rangeOk;
    };

    const startObserver = () => {
        if (tryInit()) return;

        const observer = new MutationObserver(() => {
            if (tryInit()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
