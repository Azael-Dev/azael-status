(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let observer = null;

    const setFooterYear = () => {
        if (yearSet) return false;

        const el = document.getElementById('footer-year');
        if (el && !el.textContent) {
            el.textContent = new Date().getFullYear();
            yearSet = true;
            return true;
        }

        return false;
    };

    const setDefault30Days = () => {
        if (rangeSet) return false;

        const btn = document.getElementById('data_30');
        if (btn && !btn.checked) {
            btn.click();
            rangeSet = true;
            return true;
        }

        return false;
    };

    const checkAndApply = () => {
        setFooterYear();
        setDefault30Days();

        if (yearSet && rangeSet && observer) {
            observer.disconnect();
            observer = null;
        }
    };

    const init = () => {
        checkAndApply();

        if (!yearSet || !rangeSet) {
            observer = new MutationObserver(() => {
                checkAndApply();
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                if (observer) {
                    observer.disconnect();
                    observer = null;
                }
            }, 10000);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
