(() => {
    // Set current year in footer
    const setFooterYear = () => {
        const el = document.getElementById('footer-year');
        if (!el) return false;

        el.textContent = new Date().getFullYear();
        return true;
    };

    // Set default time range to 30 days
    const setDefault30Days = () => {
        const btn30 = document.getElementById('data_30');
        if (!btn30) return false;

        if (!btn30.checked) {
            btn30.click();
        }
        return true;
    };

    // Try to initialize both features
    const tryInit = () => {
        const yearOk = setFooterYear();
        const rangeOk = setDefault30Days();

        return yearOk && rangeOk;
    };

    // Start observing DOM changes
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

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
