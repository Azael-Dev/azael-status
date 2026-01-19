// Set the current year in the footer
const initFooterYear = () => {
    const footerYearElement = document.getElementById('footer-year');

    if (footerYearElement) {
        const currentYear = new Date().getFullYear();
        footerYearElement.textContent = currentYear;
    }
};

// Initialize the footer year on page load
document.addEventListener('DOMContentLoaded', initFooterYear);
