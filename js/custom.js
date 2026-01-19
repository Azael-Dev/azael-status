(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let historySet = false;
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

        const btn = document.getElementById('data_month');
        if (btn && !btn.checked) {
            btn.click();
            rangeSet = true;

            return true;
        }

        return false;
    };

    const createUptimeHistory = async () => {
        if (historySet) return false;

        const articles = document.querySelectorAll('main > section.live-status > article');
        if (!articles.length) return false;

        try {
            const response = await fetch('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            const data = await response.json();

            articles.forEach((article) => {
                // Check if history already exists
                if (article.querySelector('.uptime-history')) return;

                // Get service name from article
                const serviceLink = article.querySelector('h4 a');
                if (!serviceLink) return;

                const serviceName = serviceLink.textContent.trim();
                const serviceData = data.find(s => s.name === serviceName);

                if (!serviceData || !serviceData.dailyMinutesDown) return;

                // Create history container
                const historyContainer = document.createElement('div');
                historyContainer.className = 'uptime-history';

                // Get last 30 days
                const today = new Date();
                const days = [];

                for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const dateStr = date.toISOString().split('T')[0];
                    days.push(dateStr);
                }

                // Create day bars
                days.forEach(dateStr => {
                    const dayBar = document.createElement('div');
                    dayBar.className = 'day';

                    const downMinutes = serviceData.dailyMinutesDown[dateStr] || 0;
                    const uptimePercent = ((1440 - downMinutes) / 1440 * 100).toFixed(2);

                    if (downMinutes === 0) {
                        dayBar.classList.add('up');
                    } else if (downMinutes < 60) {
                        dayBar.classList.add('degraded');
                    } else {
                        dayBar.classList.add('down');
                    }

                    const date = new Date(dateStr);
                    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    dayBar.setAttribute('data-tooltip', `${formattedDate}: ${uptimePercent}% uptime`);

                    historyContainer.appendChild(dayBar);
                });

                article.appendChild(historyContainer);
            });

            historySet = true;
            return true;
        } catch (error) {
            console.error('Failed to load uptime history:', error);
            return false;
        }
    };

    const checkAndApply = () => {
        setFooterYear();
        setDefault30Days();
        createUptimeHistory();

        if (yearSet && rangeSet && historySet && observer) {
            observer.disconnect();
            observer = null;
        }
    };

    const init = () => {
        checkAndApply();

        if (!yearSet || !rangeSet || !historySet) {
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
