(() => {
    'use strict';

    let yearSet = false;
    let rangeSet = false;
    let historySet = false;
    let historyFetching = false; // Flag to prevent concurrent API calls
    let observer = null;

    // Cache keys for localStorage
    const CACHE_KEY_HISTORICAL = 'uptimeHistory_historical';
    const CACHE_KEY_TODAY = 'uptimeHistory_today';
    const CACHE_KEY_TODAY_DATE = 'uptimeHistory_today_date';
    const CACHE_KEY_TODAY_TIMESTAMP = 'uptimeHistory_today_timestamp';
    const CACHE_DURATION_TODAY = 2 * 60 * 1000; // 2 minutes

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

    const fetchWithRetry = async (url, maxRetries = 3, delay = 2000) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (response.status === 403) {
                    // Rate limited - don't retry, return null to use cache
                    console.warn('GitHub API rate limited, using cached data');
                    return null;
                }
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response;
            } catch (error) {
                if (i === maxRetries - 1) throw error;
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
    };

    // Get client's timezone offset in minutes
    const getTimezoneOffsetMinutes = () => {
        return new Date().getTimezoneOffset();
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

    // Get today's date in local time
    const getTodayLocal = () => {
        return getLocalDateStr(new Date());
    };

    // Get date range for historical issues (30 days ago to today in UTC to cover timezone differences)
    const getHistoricalDateRange = () => {
        const today = new Date();
        
        const startDate = new Date(today);
        startDate.setUTCDate(startDate.getUTCDate() - 30);
        
        return {
            start: getUTCDateStr(startDate),
            end: getUTCDateStr(today)
        };
    };

    // Fetch GitHub issues for today and yesterday (to cover timezone edge cases)
    const fetchTodayIssues = async () => {
        const todayUTC = getTodayUTC();
        const todayLocal = getTodayLocal();
        const cachedTimestamp = localStorage.getItem(CACHE_KEY_TODAY_TIMESTAMP);
        const cachedDate = localStorage.getItem(CACHE_KEY_TODAY_DATE);
        const cachedData = localStorage.getItem(CACHE_KEY_TODAY);
        
        // Check if cached data is still valid (2 minutes) and same local date
        if (cachedTimestamp && cachedData && cachedDate === todayLocal) {
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
            // Fetch today's UTC date issues
            const url = `https://api.github.com/search/issues?q=repo:Azael-Dev/azael-status+author:Azael-Dev+label:status,maintenance+created:${todayUTC}&per_page=100`;
            const response = await fetchWithRetry(url);
            
            if (!response) {
                // Rate limited, return cached data
                if (cachedData) {
                    try {
                        return JSON.parse(cachedData);
                    } catch {
                        return [];
                    }
                }
                return [];
            }
            
            const data = await response.json();
            
            // Cache the result
            localStorage.setItem(CACHE_KEY_TODAY, JSON.stringify(data.items || []));
            localStorage.setItem(CACHE_KEY_TODAY_DATE, todayLocal);
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
        const todayLocal = getTodayLocal();
        
        // Check if we have cached historical data with the same date range
        if (cachedData) {
            try {
                const cached = JSON.parse(cachedData);
                const cacheAge = cached.timestamp ? (Date.now() - cached.timestamp) : Infinity;
                // Cache is valid if end date matches and cache age is less than 2 minutes
                if (cached.end === end && cached.localDate === todayLocal && cacheAge < CACHE_DURATION_TODAY) {
                    return cached.items || [];
                }
            } catch {
                // Invalid cache, continue to fetch
            }
        }

        try {
            const url = `https://api.github.com/search/issues?q=repo:Azael-Dev/azael-status+author:Azael-Dev+label:status,maintenance+created:${start}..${end}&per_page=100`;
            const response = await fetchWithRetry(url);
            
            if (!response) {
                // Rate limited, return cached data
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
            
            const data = await response.json();
            
            // Cache the result with date range info and timestamp
            localStorage.setItem(CACHE_KEY_HISTORICAL, JSON.stringify({
                start,
                end,
                localDate: todayLocal,
                timestamp: Date.now(),
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

    // Parse start/end times from issue body (maintenance schedule)
    // Format: start: YYYY-MM-DDTHH:MM:SS+HH:MM, end: YYYY-MM-DDTHH:MM:SS+HH:MM
    const parseScheduleFromBody = (body) => {
        if (!body) return null;
        
        const startMatch = body.match(/start:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/i);
        const endMatch = body.match(/end:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})/i);
        
        if (startMatch && endMatch) {
            try {
                const start = new Date(startMatch[1]);
                const end = new Date(endMatch[1]);
                if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                    return { start, end };
                }
            } catch {
                return null;
            }
        }
        
        return null;
    };

    // Process issues and group by service slug and local date
    // Issues are assigned to ALL local dates they span (start to end time)
    const processIssuesByLocalDate = (issues) => {
        const result = {};
        
        issues.forEach(issue => {
            if (!issue.created_at || !issue.labels) return;
            
            // Find ALL slug labels (not 'status' or 'maintenance')
            const slugLabels = issue.labels.filter(label => 
                label.name && label.name !== 'status' && label.name !== 'maintenance'
            );
            
            if (slugLabels.length === 0) return;
            
            // Check if this is a maintenance issue
            const isMaintenance = issue.labels.some(label => label.name === 'maintenance');
            
            // Try to get scheduled time from body, fallback to created_at/closed_at
            const schedule = parseScheduleFromBody(issue.body);
            
            let startTime, endTime;
            if (schedule) {
                startTime = schedule.start;
                endTime = schedule.end;
            } else {
                startTime = new Date(issue.created_at);
                endTime = issue.closed_at ? new Date(issue.closed_at) : new Date();
            }
            
            // Get start and end local dates
            const startLocalDate = getLocalDateStr(startTime);
            const endLocalDate = getLocalDateStr(endTime);
            
            // Process for each slug label
            slugLabels.forEach(slugLabel => {
                const slug = slugLabel.name;
                
                // Add issue to each local date it spans
                let currentDateStr = startLocalDate;
                const maxIterations = 365; // Safety limit
                let iterations = 0;
                
                while (currentDateStr <= endLocalDate && iterations < maxIterations) {
                    if (!result[slug]) {
                        result[slug] = {};
                    }
                    
                    if (!result[slug][currentDateStr]) {
                        result[slug][currentDateStr] = [];
                    }
                    
                    // Check if issue already added for this date (use issue id)
                    const issueId = issue.id || issue.created_at;
                    const existingIssue = result[slug][currentDateStr].find(i => i.id === issueId);
                    if (!existingIssue) {
                        result[slug][currentDateStr].push({
                            id: issueId,
                            start_time: startTime.toISOString(),
                            end_time: endTime.toISOString(),
                            title: issue.title,
                            state: issue.state,
                            isMaintenance: isMaintenance
                        });
                    }
                    
                    // Move to next day
                    const [year, month, day] = currentDateStr.split('-').map(Number);
                    const nextDate = new Date(year, month - 1, day);
                    nextDate.setDate(nextDate.getDate() + 1);
                    currentDateStr = getLocalDateStr(nextDate);
                    iterations++;
                }
            });
        });
        
        return result;
    };

    // Calculate downtime for a specific local date based on issues
    // Calculates only the portion of downtime that falls within the local date
    // Returns object with: { minutes, isMaintenance, isDegraded, isDown, hasIssue }
    const calculateLocalDowntime = (issuesByLocalDate, slug, localDateStr) => {
        // Parse local date boundaries
        const [year, month, day] = localDateStr.split('-').map(Number);
        const dayStart = new Date(year, month - 1, day, 0, 0, 0, 0);
        const dayEnd = new Date(year, month - 1, day, 23, 59, 59, 999);
        
        // Check if there are issues for this slug and date
        if (issuesByLocalDate[slug] && issuesByLocalDate[slug][localDateStr]) {
            const issues = issuesByLocalDate[slug][localDateStr];
            let totalMinutes = 0;
            let hasMaintenance = false;
            let hasDegraded = false;
            let hasDown = false;
            
            issues.forEach(issue => {
                const startTime = new Date(issue.start_time);
                const endTime = new Date(issue.end_time);
                const title = (issue.title || '').toLowerCase();
                
                // Track issue type from title
                if (issue.isMaintenance) {
                    hasMaintenance = true;
                } else if (title.includes('is down')) {
                    hasDown = true;
                } else if (title.includes('has degraded performance')) {
                    hasDegraded = true;
                }
                
                // Clamp to local date boundaries
                const effectiveStart = startTime < dayStart ? dayStart : startTime;
                const effectiveEnd = endTime > dayEnd ? dayEnd : endTime;
                
                // Calculate duration within this day
                if (effectiveEnd > effectiveStart) {
                    const minutes = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60));
                    totalMinutes += minutes;
                }
            });
            
            return {
                minutes: Math.min(totalMinutes, 1440), // Cap at 24 hours
                isMaintenance: hasMaintenance,
                isDegraded: hasDegraded,
                isDown: hasDown,
                hasIssue: true
            };
        }
        
        // No issues for this date
        return {
            minutes: 0,
            isMaintenance: false,
            isDegraded: false,
            isDown: false,
            hasIssue: false
        };
    };

    // Reset flags and clear processed markers
    const resetAndReapply = () => {
        historySet = false;
        historyFetching = false;
        rangeSet = false;
        document.querySelectorAll('[data-status-replaced]').forEach(el => {
            el.removeAttribute('data-status-replaced');
        });
        document.querySelectorAll('[data-target-processed]').forEach(el => {
            el.removeAttribute('data-target-processed');
        });
        // Remove existing history bars to rebuild with fresh data
        document.querySelectorAll('.uptime-history, .uptime-history-labels').forEach(el => {
            el.remove();
        });
        checkAndApply();
    };

    const addTargetBlankToExternalLinks = () => {
        // Get all links on the page
        const links = document.querySelectorAll('a[href]');
        
        links.forEach(link => {
            const href = link.getAttribute('href');
            
            // Skip if already processed
            if (link.hasAttribute('data-target-processed')) return;
            
            // Skip if it's a relative link or anchor link
            if (!href || href.startsWith('#') || href.startsWith('/')) {
                link.setAttribute('data-target-processed', 'true');
                return;
            }
            
            // Check if link is external (not status.azael.dev)
            try {
                const url = new URL(href, window.location.href);
                if (!url.hostname.includes('status.azael.dev')) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                }
            } catch (e) {
                // Invalid URL, skip
            }
            
            link.setAttribute('data-target-processed', 'true');
        });
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
        // Prevent concurrent API calls
        if (historyFetching) return false;
        
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
        
        // Set fetching flag
        historyFetching = true;

        try {
            // Fetch summary data
            const response = await fetchWithRetry('https://raw.githubusercontent.com/Azael-Dev/azael-status/master/history/summary.json');
            if (!response) {
                historyFetching = false;
                return false;
            }
            const data = await response.json();

            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format: expected array');
            }

            // Fetch GitHub issues (today and historical) - only once
            let todayIssues = [];
            let historicalIssues = [];
            
            try {
                [todayIssues, historicalIssues] = await Promise.all([
                    fetchTodayIssues(),
                    fetchHistoricalIssues()
                ]);
            } catch (e) {
                console.warn('Could not fetch GitHub issues:', e);
            }

            // Combine and process all issues
            const allIssues = [...todayIssues, ...historicalIssues];
            const issuesByLocalDate = processIssuesByLocalDate(allIssues);

            // Get current date from client (local time)
            const today = new Date();

            // Process articles using requestAnimationFrame
            let articleIndex = 0;
            const processNextArticle = () => {
                if (articleIndex >= articles.length) {
                    historySet = true;
                    historyFetching = false;
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
                    const downtimeInfo = calculateLocalDowntime(
                        issuesByLocalDate, 
                        slug, 
                        localDateStr
                    );
                    const downMinutes = downtimeInfo.minutes;
                    const uptimePercent = ((1440 - downMinutes) / 1440 * 100).toFixed(2);

                    // Determine severity level based on issue type
                    // Priority: down > degraded > maintenance > up
                    let severityClass;
                    if (!downtimeInfo.hasIssue) {
                        severityClass = 'up';
                    } else if (downtimeInfo.isDown) {
                        severityClass = 'down';
                    } else if (downtimeInfo.isDegraded) {
                        severityClass = 'degraded';
                    } else if (downtimeInfo.isMaintenance) {
                        severityClass = 'maintenance';
                    } else {
                        // Fallback for issues without recognized title pattern
                        severityClass = 'unknown';
                    }

                    dayBar.classList.add(severityClass);

                    // Format local date for display
                    const formattedDate = formatLocalDate(localDateStr);

                    // Format outage/maintenance duration
                    let durationText = '';
                    let durationLabel = 'Duration';
                    
                    if (downtimeInfo.isMaintenance) {
                        durationLabel = 'Maintenance';
                    } else if (downtimeInfo.isDown) {
                        durationLabel = 'Downtime';
                    } else if (downtimeInfo.isDegraded) {
                        durationLabel = 'Degraded';
                    }

                    if (downtimeInfo.hasIssue && downMinutes !== 0) {
                        const hours = Math.floor(downMinutes / 60);
                        const minutes = downMinutes % 60;

                        if (hours > 0 && minutes > 0) {
                            durationText = `${durationLabel}: ${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
                        } else if (hours > 0) {
                            durationText = `${durationLabel}: ${hours} hour${hours > 1 ? 's' : ''}`;
                        } else {
                            durationText = `${durationLabel}: ${minutes} minute${minutes > 1 ? 's' : ''}`;
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
            historyFetching = false;
            return false;
        }
    };

    const checkAndApply = () => {
        setFooterYear();
        setDefault30Days();
        replaceStatusText();
        createUptimeHistory();
        addTargetBlankToExternalLinks();
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
