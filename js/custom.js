(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let historySet = false;
    let observer = null;

    // Cache configuration
    const CACHE_KEY = 'serverTimeCache';
    const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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

    const fetchWithRetry = async (url, maxRetries = 3, delay = 1000) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
    };

    const getServerTime = async () => {
        try {
            // Get client timezone
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            // Try to get cached data from localStorage
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                try {
                    const { time, tz, timestamp } = JSON.parse(cached);
                    const now = Date.now();

                    // Return cached time if timezone hasn't changed and cache is still valid
                    if (tz === timezone && (now - timestamp) < CACHE_DURATION) {
                        return new Date(time);
                    }
                } catch (e) {
                    // Invalid cache data, remove it
                    localStorage.removeItem(CACHE_KEY);
                }
            }

            // Fetch time from World Time API with retry
            const response = await fetchWithRetry(`https://worldtimeapi.org/api/timezone/${timezone}`);
            const timeData = await response.json();
            const serverTime = new Date(timeData.datetime);

            // Cache the result in localStorage
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                time: serverTime.toISOString(),
                tz: timezone,
                timestamp: Date.now()
            }));

            return serverTime;
        } catch (error) {
            console.warn('Failed to fetch server time, using client time:', error);
            const clientTime = new Date();

            // Cache client time as fallback if no cache exists
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) {
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    time: clientTime.toISOString(),
                    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    timestamp: Date.now()
                }));
            }

            return clientTime;
        }
    };

    const createUptimeHistory = async () => {
        const articles = document.querySelectorAll('main > section.live-status > article');
        if (!articles.length) return false;

        const hasAnyHistory = Array.from(articles).some(article => article.querySelector('.uptime-history'));
        if (!hasAnyHistory && historySet) {
            historySet = false;
        }

        if (historySet) return false;

        try {
            const response = await fetchWithRetry('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            const data = await response.json();

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Get reliable current date
            const today = await getServerTime();

            // Process articles using requestAnimationFrame
            let articleIndex = 0;
            const processNextArticle = () => {
                if (articleIndex >= articles.length) {
                    historySet = true;
                    return;
                }

                const article = articles[articleIndex];
                // Check if history already exists
                if (article.querySelector('.uptime-history')) {
                    articleIndex++;
                    requestAnimationFrame(processNextArticle);
                    return;
                }

                // Get service name from article
                const serviceLink = article.querySelector('h4 a');
                if (!serviceLink) {
                    articleIndex++;
                    requestAnimationFrame(processNextArticle);
                    return;
                }

                const serviceName = serviceLink.textContent.trim();
                const serviceData = data.find(s => s.name === serviceName);

                if (!serviceData || !serviceData.dailyMinutesDown) {
                    articleIndex++;
                    requestAnimationFrame(processNextArticle);
                    return;
                }

                // Create history container
                const historyContainer = document.createElement('div');
                historyContainer.className = 'uptime-history';

                // Get last 30 days
                const days = [];

                for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);

                    // Use local date instead of UTC
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${day}`;

                    days.push(dateStr);
                }

                // Create day bars using document fragment for better performance
                const fragment = document.createDocumentFragment();
                days.forEach(dateStr => {
                    const dayBar = document.createElement('div');
                    dayBar.className = 'day';

                    const downMinutes = serviceData.dailyMinutesDown[dateStr] || 0;
                    const uptimePercent = ((1440 - downMinutes) / 1440 * 100).toFixed(2);

                    // Determine severity level
                    let severityClass = '';
                    let severityLabel = '';

                    if (downMinutes === 0) {
                        severityClass = 'up';
                    } else if (downMinutes < 30) {
                        severityClass = 'minor';
                        severityLabel = 'Minor Outage';
                    } else if (downMinutes < 60) {
                        severityClass = 'partial';
                        severityLabel = 'Partial Outage';
                    } else {
                        severityClass = 'major';
                        severityLabel = 'Major Outage';
                    }

                    dayBar.classList.add(severityClass);

                    // Parse date correctly to avoid timezone issues
                    // Split the date string and create date with local timezone
                    const [year, month, day] = dateStr.split('-').map(Number);
                    const date = new Date(year, month - 1, day);
                    const formattedDate = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

                    // Format outage duration
                    let durationText = '';

                    if (downMinutes !== 0) {
                        const hours = Math.floor(downMinutes / 60);
                        const minutes = downMinutes % 60;

                        if (hours > 0 && minutes > 0) {
                            durationText = `${severityLabel}: ${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
                        } else if (hours > 0) {
                            durationText = `${severityLabel}: ${hours} hour${hours > 1 ? 's' : ''}`;
                        } else {
                            durationText = `${severityLabel}: ${minutes} minute${minutes > 1 ? 's' : ''}`;
                        }
                    }

                    dayBar.setAttribute('data-tooltip', `Date: ${formattedDate}\nUptime: ${uptimePercent}%\n${durationText}`);

                    fragment.appendChild(dayBar);
                });
                historyContainer.appendChild(fragment);

                // Create date range labels container
                const labelsContainer = document.createElement('div');
                labelsContainer.className = 'uptime-history-labels';

                const leftLabel = document.createElement('span');
                leftLabel.textContent = '30 days ago';
                leftLabel.className = 'label-left';

                const rightLabel = document.createElement('span');
                rightLabel.textContent = 'Today';
                rightLabel.className = 'label-right';

                labelsContainer.appendChild(leftLabel);
                labelsContainer.appendChild(rightLabel);

                article.appendChild(historyContainer);
                article.appendChild(labelsContainer);

                articleIndex++;
                requestAnimationFrame(processNextArticle);
            };

            requestAnimationFrame(processNextArticle);
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
    };

    const init = () => {
        checkAndApply();

        // Keep observer running continuously to handle dynamic page changes
        observer = new MutationObserver(() => {
            checkAndApply();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Handle back/forward navigation and route changes
        window.addEventListener('popstate', () => {
            historySet = false;
            rangeSet = false;
            checkAndApply();
        });

        // Monitor URL changes for SPA routing
        let lastUrl = location.href;
        new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                historySet = false;
                rangeSet = false;
                checkAndApply();
            }
        }).observe(document, { subtree: true, childList: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
