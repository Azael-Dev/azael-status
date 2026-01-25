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

    // Get downtime minutes for a UTC date string
    // Since dailyMinutesDown stores total downtime per UTC day without timestamp details,
    // we cannot accurately map local timezone to UTC. Therefore, we display UTC dates
    // to all clients for consistency and accuracy.
    const getDownMinutesForDate = (dailyMinutesDown, dateStr) => {
        return dailyMinutesDown[dateStr] || 0;
    };

    const replaceStatusText = () => {
        const articles = document.querySelectorAll('main > section.live-status > article');
        if (!articles.length) return;

        articles.forEach(article => {
            // Skip if already processed
            if (article.hasAttribute('data-status-replaced')) return;

            const statusSpan = article.querySelector('h4 + div > span');
            if (!statusSpan) return;

            // Wait briefly to ensure original content is loaded
            setTimeout(() => {
                let statusText = '';
                if (article.classList.contains('up')) {
                    statusText = 'Operational';
                } else if (article.classList.contains('degraded')) {
                    statusText = 'Degraded';
                } else if (article.classList.contains('down')) {
                    statusText = 'Down';
                }

                if (statusText) {
                    statusSpan.textContent = statusText;
                    article.setAttribute('data-status-replaced', 'true');
                }
            }, 3000);
        });
    };

    const createUptimeHistory = async () => {
        const articles = document.querySelectorAll('main > section.live-status > article');
        if (!articles.length) return false;

        // Check if there are any unprocessed articles
        const hasUnprocessedArticles = Array.from(articles).some(article => !article.querySelector('.uptime-history'));
        
        if (!hasUnprocessedArticles) {
            historySet = true;
            return false;
        }

        // Reset historySet if previously set but articles changed
        if (historySet) historySet = false;

        try {
            const response = await fetchWithRetry('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            const data = await response.json();

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Get current date from client
            const today = new Date();

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

                    // Use UTC date to match dailyMinutesDown keys (stored as UTC)
                    const year = date.getUTCFullYear();
                    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
                    const day = String(date.getUTCDate()).padStart(2, '0');
                    const dateStr = `${year}-${month}-${day}`;

                    days.push(dateStr);
                }

                // Create day bars using document fragment for better performance
                const fragment = document.createDocumentFragment();
                days.forEach(dateStr => {
                    const dayBar = document.createElement('div');
                    dayBar.className = 'day';

                    // Get downtime from UTC date (dailyMinutesDown stores UTC dates)
                    const downMinutes = getDownMinutesForDate(serviceData.dailyMinutesDown, dateStr);
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

                    // Parse and format UTC date for display (all clients see the same date)
                    const [year, month, day] = dateStr.split('-').map(Number);
                    const dateObj = new Date(Date.UTC(year, month - 1, day));
                    const formattedDate = dateObj.toLocaleDateString('en-GB', { 
                        day: 'numeric', 
                        month: 'short', 
                        year: 'numeric',
                        timeZone: 'UTC'
                    });

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
        replaceStatusText();
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
            // Reset all flags and clear processed markers
            historySet = false;
            rangeSet = false;
            
            // Clear status replacement markers
            document.querySelectorAll('[data-status-replaced]').forEach(el => {
                el.removeAttribute('data-status-replaced');
            });
            
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
                
                // Clear status replacement markers
                document.querySelectorAll('[data-status-replaced]').forEach(el => {
                    el.removeAttribute('data-status-replaced');
                });
                
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
