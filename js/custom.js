(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let historySet = false;
    let observer = null;

    // GitHub API configuration
    const GITHUB_API = {
        repo: 'Azael-Dev/azael-status',
        author: 'Azael-Dev',
        label: 'status',
        rateLimit: { requests: 10, perMinutes: 1 },
        queue: [],
        processing: false,
        lastRequest: 0
    };

    // Cache configuration
    const CACHE_PREFIX = 'uptime_incidents_';
    const CACHE_DURATION_CURRENT = 5 * 60 * 1000; // 5 minutes for current date
    const CACHE_DURATION_PAST = 24 * 60 * 60 * 1000; // 24 hours for past dates

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

    // Get cache key for incidents
    const getCacheKey = (slug, dateRange) => {
        return `${CACHE_PREFIX}${slug}_${dateRange}`;
    };

    // Get cached incidents
    const getCachedIncidents = (slug, dateRange, isCurrentDate) => {
        try {
            const cacheKey = getCacheKey(slug, dateRange);
            const cached = localStorage.getItem(cacheKey);
            if (!cached) return null;

            const { data, timestamp } = JSON.parse(cached);
            const age = Date.now() - timestamp;
            const maxAge = isCurrentDate ? CACHE_DURATION_CURRENT : CACHE_DURATION_PAST;

            if (age > maxAge) {
                localStorage.removeItem(cacheKey);
                return null;
            }

            return data;
        } catch (error) {
            return null;
        }
    };

    // Set cached incidents
    const setCachedIncidents = (slug, dateRange, data) => {
        try {
            const cacheKey = getCacheKey(slug, dateRange);
            localStorage.setItem(cacheKey, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (error) {
            // Ignore cache errors
        }
    };

    // Rate-limited GitHub API fetch
    const fetchGitHubIssues = async (slug, dateRange, isCurrentDate) => {
        // Check cache first
        const cached = getCachedIncidents(slug, dateRange, isCurrentDate);
        if (cached) return cached;

        return new Promise((resolve, reject) => {
            GITHUB_API.queue.push({ slug, dateRange, isCurrentDate, resolve, reject });
            processGitHubQueue();
        });
    };

    // Process GitHub API queue with rate limiting
    const processGitHubQueue = async () => {
        if (GITHUB_API.processing || GITHUB_API.queue.length === 0) return;

        GITHUB_API.processing = true;

        while (GITHUB_API.queue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - GITHUB_API.lastRequest;
            const minDelay = (GITHUB_API.rateLimit.perMinutes * 60 * 1000) / GITHUB_API.rateLimit.requests;

            if (timeSinceLastRequest < minDelay) {
                await new Promise(resolve => setTimeout(resolve, minDelay - timeSinceLastRequest));
            }

            const { slug, dateRange, isCurrentDate, resolve, reject } = GITHUB_API.queue.shift();

            try {
                const query = `repo:${GITHUB_API.repo}+author:${GITHUB_API.author}+label:${GITHUB_API.label}+label:${slug}+created:${dateRange}`;
                const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}`;
                
                GITHUB_API.lastRequest = Date.now();
                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`GitHub API error: ${response.status}`);
                }

                const data = await response.json();
                const incidents = data.items || [];

                // Cache incidents (current date cached for 5 min, past dates for 24 hours)
                setCachedIncidents(slug, dateRange, incidents);

                resolve(incidents);
            } catch (error) {
                reject(error);
            }
        }

        GITHUB_API.processing = false;
    };

    // Calculate downtime minutes for a specific local date from incidents
    const calculateDowntimeForDate = (incidents, localDateStr, timezoneOffset) => {
        let totalMinutes = 0;
        const [year, month, day] = localDateStr.split('-').map(Number);
        const dayStart = new Date(year, month - 1, day, 0, 0, 0);
        const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);

        incidents.forEach(incident => {
            const createdAt = new Date(incident.created_at);
            const closedAt = incident.closed_at ? new Date(incident.closed_at) : new Date();

            // Check if incident overlaps with the local date
            if (closedAt >= dayStart && createdAt <= dayEnd) {
                const overlapStart = createdAt > dayStart ? createdAt : dayStart;
                const overlapEnd = closedAt < dayEnd ? closedAt : dayEnd;
                const minutes = Math.ceil((overlapEnd - overlapStart) / (1000 * 60));
                totalMinutes += minutes;
            }
        });

        return totalMinutes;
    };

    // Format local date string (YYYY-MM-DD) to readable format
    const formatLocalDate = (dateStr) => {
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        return date.toLocaleDateString('en-US', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    };

    // Get UTC date string from Date object
    const getUTCDateStr = (date) => {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Get local date string from Date object
    const getLocalDateStr = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
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
            const response = await fetchWithRetry('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            const data = await response.json();

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Get current date
            const today = new Date();
            const currentUTCDate = getUTCDateStr(today);

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

                if (!serviceData || !serviceData.slug) {
                    articleIndex++;
                    requestAnimationFrame(processNextArticle);
                    return;
                }

                // Create history container
                const historyContainer = document.createElement('div');
                historyContainer.className = 'uptime-history';

                // Get last 30 days (local dates)
                const days = [];
                const utcDatesWithDowntime = new Set();

                // Collect UTC dates that have downtime
                if (serviceData.dailyMinutesDown) {
                    Object.keys(serviceData.dailyMinutesDown).forEach(utcDate => {
                        if (serviceData.dailyMinutesDown[utcDate] > 0) {
                            utcDatesWithDowntime.add(utcDate);
                        }
                    });
                }

                for (let i = 29; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i);
                    const localDateStr = getLocalDateStr(date);
                    const utcDateStr = getUTCDateStr(date);
                    const isCurrentDate = utcDateStr === currentUTCDate;

                    days.push({ 
                        local: localDateStr, 
                        utc: utcDateStr,
                        isCurrentDate
                    });
                }

                // Batch fetch incidents
                const fetchIncidents = async () => {
                    try {
                        // Find date range for batch request
                        const datesWithDowntime = days.filter(day => 
                            utcDatesWithDowntime.has(day.utc) || day.isCurrentDate
                        );

                        if (datesWithDowntime.length === 0) {
                            renderHistory(days, {});
                            return;
                        }

                        // Group consecutive dates for efficient API calls
                        const dateRanges = [];
                        let currentRange = null;

                        datesWithDowntime.forEach(day => {
                            if (day.isCurrentDate) {
                                // Current date: single date query
                                dateRanges.push({
                                    range: day.utc,
                                    isCurrentDate: true,
                                    dates: [day]
                                });
                            } else if (!currentRange) {
                                currentRange = { start: day.utc, end: day.utc, dates: [day] };
                            } else {
                                currentRange.end = day.utc;
                                currentRange.dates.push(day);
                            }
                        });

                        if (currentRange) {
                            dateRanges.push({
                                range: currentRange.start === currentRange.end 
                                    ? currentRange.start 
                                    : `${currentRange.start}..${currentRange.end}`,
                                isCurrentDate: false,
                                dates: currentRange.dates
                            });
                        }

                        // Fetch incidents for each range
                        const allIncidents = [];
                        for (const { range, isCurrentDate } of dateRanges) {
                            try {
                                const incidents = await fetchGitHubIssues(serviceData.slug, range, isCurrentDate);
                                allIncidents.push(...incidents);
                            } catch (error) {
                                console.error(`Failed to fetch incidents for ${range}:`, error);
                            }
                        }

                        // Calculate downtime per local date from incidents
                        const downtimeByLocalDate = {};
                        const timezoneOffset = new Date().getTimezoneOffset();

                        days.forEach(day => {
                            const downMinutes = calculateDowntimeForDate(allIncidents, day.local, timezoneOffset);
                            downtimeByLocalDate[day.local] = downMinutes;
                        });

                        renderHistory(days, downtimeByLocalDate);
                    } catch (error) {
                        console.error('Failed to fetch incidents:', error);
                        // Fallback to UTC-based display
                        const fallbackDowntime = {};
                        days.forEach(day => {
                            fallbackDowntime[day.local] = (serviceData.dailyMinutesDown || {})[day.utc] || 0;
                        });
                        renderHistory(days, fallbackDowntime);
                    }
                };

                // Render history bars
                const renderHistory = (days, downtimeByLocalDate) => {
                    const fragment = document.createDocumentFragment();

                    days.forEach(day => {
                        const dayBar = document.createElement('div');
                        dayBar.className = 'day';

                        const downMinutes = downtimeByLocalDate[day.local] || 0;
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
                        const formattedDate = formatLocalDate(day.local);

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

                // Start fetching and rendering
                fetchIncidents();
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
