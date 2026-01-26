(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let historySet = false;
    let observer = null;

    // Cache keys for localStorage
    const CACHE_KEY_HISTORICAL = 'uptimeHistory_historical';
    const CACHE_KEY_TODAY = 'uptimeHistory_today';
    const CACHE_KEY_TODAY_TIMESTAMP = 'uptimeHistory_today_timestamp';
    const CACHE_DURATION_TODAY = 5 * 60 * 1000; // 5 minutes

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

    // Get client's timezone offset name
    const getTimezoneDisplay = () => {
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return timezone || 'Local';
        } catch {
            return 'Local';
        }
    };

    // Format local date string (YYYY-MM-DD) to readable format in client timezone
    const formatLocalDate = (dateStr) => {
        const [year, month, day] = dateStr.split('-');
        const date = new Date(year, month - 1, day);
        const timezone = getTimezoneDisplay();
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        }) + ` (${timezone})`;
    };

    // Get local date string (YYYY-MM-DD) from Date object
    const getLocalDateStr = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Get UTC date string (YYYY-MM-DD) from Date object
    const getUTCDateStr = (date) => {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Convert ISO timestamp to local date string
    const isoToLocalDateStr = (isoString) => {
        const date = new Date(isoString);
        return getLocalDateStr(date);
    };

    // Get today's date in UTC for API query
    const getTodayUTC = () => {
        return getUTCDateStr(new Date());
    };

    // Get date range for historical issues (29 days ago to yesterday in UTC)
    const getHistoricalDateRange = () => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        
        const startDate = new Date(today);
        startDate.setUTCDate(startDate.getUTCDate() - 29);
        
        return {
            start: getUTCDateStr(startDate),
            end: getUTCDateStr(yesterday)
        };
    };

    // Fetch GitHub issues for a specific date (today)
    const fetchTodayIssues = async () => {
        const todayUTC = getTodayUTC();
        const cachedTimestamp = localStorage.getItem(CACHE_KEY_TODAY_TIMESTAMP);
        const cachedData = localStorage.getItem(CACHE_KEY_TODAY);
        
        // Check if cached data is still valid (5 minutes)
        if (cachedTimestamp && cachedData) {
            const cacheAge = Date.now() - parseInt(cachedTimestamp, 10);
            if (cacheAge < CACHE_DURATION_TODAY) {
                try {
                    return JSON.parse(cachedData);
                } catch {
                    // Invalid cache, continue to fetch
                }
            }
        }

        try {
            const url = `https://api.github.com/search/issues?q=repo:Azael-Dev/azael-status+author:Azael-Dev+label:status+created:${todayUTC}`;
            const response = await fetchWithRetry(url);
            const data = await response.json();
            
            // Cache the result
            localStorage.setItem(CACHE_KEY_TODAY, JSON.stringify(data.items || []));
            localStorage.setItem(CACHE_KEY_TODAY_TIMESTAMP, Date.now().toString());
            
            return data.items || [];
        } catch (error) {
            console.error('Failed to fetch today issues:', error);
            // Return cached data if available, even if expired
            if (cachedData) {
                try {
                    return JSON.parse(cachedData);
                } catch {
                    return [];
                }
            }
            return [];
        }
    };

    // Fetch GitHub issues for historical date range
    const fetchHistoricalIssues = async () => {
        const cachedData = localStorage.getItem(CACHE_KEY_HISTORICAL);
        const { start, end } = getHistoricalDateRange();
        
        // Check if we have cached historical data with the same date range
        if (cachedData) {
            try {
                const cached = JSON.parse(cachedData);
                if (cached.start === start && cached.end === end) {
                    return cached.items || [];
                }
            } catch {
                // Invalid cache, continue to fetch
            }
        }

        try {
            const url = `https://api.github.com/search/issues?q=repo:Azael-Dev/azael-status+author:Azael-Dev+label:status+created:${start}..${end}&per_page=100`;
            const response = await fetchWithRetry(url);
            const data = await response.json();
            
            // Cache the result with date range info
            localStorage.setItem(CACHE_KEY_HISTORICAL, JSON.stringify({
                start,
                end,
                items: data.items || []
            }));
            
            return data.items || [];
        } catch (error) {
            console.error('Failed to fetch historical issues:', error);
            // Return cached data if available
            if (cachedData) {
                try {
                    const cached = JSON.parse(cachedData);
                    return cached.items || [];
                } catch {
                    return [];
                }
            }
            return [];
        }
    };

    // Process issues and group by service slug and local date
    const processIssuesByLocalDate = (issues) => {
        const result = {};
        
        issues.forEach(issue => {
            if (!issue.created_at || !issue.labels) return;
            
            // Find the slug label (not 'status')
            const slugLabel = issue.labels.find(label => 
                label.name && label.name !== 'status'
            );
            
            if (!slugLabel) return;
            
            const slug = slugLabel.name;
            const localDateStr = isoToLocalDateStr(issue.created_at);
            
            if (!result[slug]) {
                result[slug] = {};
            }
            
            if (!result[slug][localDateStr]) {
                result[slug][localDateStr] = [];
            }
            
            result[slug][localDateStr].push({
                created_at: issue.created_at,
                title: issue.title,
                state: issue.state,
                closed_at: issue.closed_at
            });
        });
        
        return result;
    };

    // Calculate downtime for a specific local date based on issues
    const calculateLocalDowntime = (issuesByLocalDate, slug, localDateStr, dailyMinutesDown, summaryData) => {
        // Get total UTC downtime from summary
        const totalUTCDowntime = Object.values(dailyMinutesDown).reduce((sum, val) => sum + val, 0);
        
        // If no issues data, fallback to checking if any UTC date maps to this local date
        if (!issuesByLocalDate[slug] || !issuesByLocalDate[slug][localDateStr]) {
            // Check if any UTC dates could map to this local date
            let estimatedDowntime = 0;
            
            for (const [utcDateStr, minutes] of Object.entries(dailyMinutesDown)) {
                // Create date range for UTC date
                const [year, month, day] = utcDateStr.split('-');
                const utcStart = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
                const utcEnd = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
                
                // Check if any part of UTC date falls on local date
                const localStartOfUtc = getLocalDateStr(utcStart);
                const localEndOfUtc = getLocalDateStr(utcEnd);
                
                if (localStartOfUtc === localDateStr || localEndOfUtc === localDateStr) {
                    // Approximate distribution based on overlap
                    if (localStartOfUtc === localDateStr && localEndOfUtc === localDateStr) {
                        estimatedDowntime += minutes;
                    } else {
                        // Partial overlap - estimate 50% attribution
                        estimatedDowntime += Math.ceil(minutes / 2);
                    }
                }
            }
            
            return estimatedDowntime;
        }
        
        // We have issue data for this local date
        const issues = issuesByLocalDate[slug][localDateStr];
        let totalMinutes = 0;
        
        issues.forEach(issue => {
            const createdAt = new Date(issue.created_at);
            let endTime;
            
            if (issue.closed_at) {
                endTime = new Date(issue.closed_at);
            } else {
                // If not closed, assume it's ongoing or ended at midnight local time
                const [year, month, day] = localDateStr.split('-');
                endTime = new Date(year, month - 1, day, 23, 59, 59);
            }
            
            // Clamp to the local date boundaries
            const [year, month, day] = localDateStr.split('-');
            const dayStart = new Date(year, month - 1, day, 0, 0, 0);
            const dayEnd = new Date(year, month - 1, day, 23, 59, 59);
            
            const effectiveStart = createdAt < dayStart ? dayStart : createdAt;
            const effectiveEnd = endTime > dayEnd ? dayEnd : endTime;
            
            if (effectiveEnd > effectiveStart) {
                const minutes = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60));
                totalMinutes += minutes;
            }
        });
        
        return Math.min(totalMinutes, 1440); // Cap at 24 hours
    };

    // Reset flags and clear processed markers
    const resetAndReapply = () => {
        historySet = false;
        rangeSet = false;
        document.querySelectorAll('[data-status-replaced]').forEach(el => {
            el.removeAttribute('data-status-replaced');
        });
        checkAndApply();
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
            // Fetch summary data
            const response = await fetchWithRetry('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            const data = await response.json();

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Fetch GitHub issues (today and historical)
            const [todayIssues, historicalIssues] = await Promise.all([
                fetchTodayIssues(),
                fetchHistoricalIssues()
            ]);

            // Combine and process all issues
            const allIssues = [...todayIssues, ...historicalIssues];
            const issuesByLocalDate = processIssuesByLocalDate(allIssues);

            // Get current date from client (local time)
            const today = new Date();
            const todayLocalStr = getLocalDateStr(today);

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

                if (!serviceData) {
                    articleIndex++;
                    requestAnimationFrame(processNextArticle);
                    return;
                }

                const slug = serviceData.slug || '';
                const dailyMinutesDown = serviceData.dailyMinutesDown || {};

                // Create history container
                const historyContainer = document.createElement('div');
                historyContainer.className = 'uptime-history';

                // Get last 30 days in local time
                const days = [];

                for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const localDateStr = getLocalDateStr(date);
                    days.push(localDateStr);
                }

                // Create day bars using document fragment for better performance
                const fragment = document.createDocumentFragment();
                days.forEach(localDateStr => {
                    const dayBar = document.createElement('div');
                    dayBar.className = 'day';

                    // Calculate downtime for local date
                    const downMinutes = calculateLocalDowntime(
                        issuesByLocalDate, 
                        slug, 
                        localDateStr, 
                        dailyMinutesDown,
                        serviceData
                    );
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

                    // Format local date for display
                    const formattedDate = formatLocalDate(localDateStr);

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

        // Handle back/forward navigation
        window.addEventListener('popstate', resetAndReapply);

        // Monitor URL changes for SPA routing
        let lastUrl = location.href;
        new MutationObserver(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                resetAndReapply();
            }
        }).observe(document, { subtree: true, childList: true });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
