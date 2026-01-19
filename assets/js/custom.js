// Set the current year in the footer (Upptime-safe)
(() => {
    const setYear = () => {
        const el = document.getElementById('footer-year');
        if (!el) return false;

        el.textContent = new Date().getFullYear();
        return true;
    };

    const startObserver = () => {
        if (setYear()) return;

        const observer = new MutationObserver(() => {
            if (setYear()) {
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    };

    if (!document.body) {
        document.addEventListener('DOMContentLoaded', startObserver);
    } else {
        startObserver();
    }
})();
