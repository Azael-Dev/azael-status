// Set the current year in the footer
(() => {
    const initFooterYear = () => {
        const footerYearElement = document.getElementById('footer-year');

        if (footerYearElement) {
            footerYearElement.textContent = new Date().getFullYear();
        }
    };

    // Initialize when the DOM is fully loaded
    document.addEventListener('DOMContentLoaded', initFooterYear);
})();
