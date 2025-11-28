/**
 * DOM manipulation utility functions
 */

export const DomUtils = {
    /**
     * Get element by ID with error checking and logging
     * @param id - Element ID to find
     * @returns HTMLElement or null if not found
     */
    getElementById: (id: string): HTMLElement | null => {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with ID '${id}' not found`);
        }
        return element;
    },

    /**
     * Create DOM element with attributes and text content
     * @param tag - HTML tag name
     * @param attributes - Object of attribute key-value pairs
     * @param textContent - Text content for the element
     * @returns Created HTMLElement
     */
    createElement: (tag: string, attributes: Record<string, string> = {}, textContent: string = ''): HTMLElement => {
        const element = document.createElement(tag);
        Object.keys(attributes).forEach(key => {
            element.setAttribute(key, attributes[key]);
        });
        if (textContent) {
            element.textContent = textContent;
        }
        return element;
    },

    /**
     * Add CSS class with fade-in animation
     * @param element - Element to modify
     * @param className - CSS class to add
     * @param duration - Animation duration in milliseconds
     */
    addClassWithAnimation: (element: HTMLElement, className: string, duration: number = 300): void => {
        element.classList.add(className);
        setTimeout(() => {
            element.classList.add('fade-in');
        }, 10);
    },

    /**
     * Remove CSS class with fade-out animation
     * @param element - Element to modify
     * @param className - CSS class to remove
     * @param duration - Animation duration in milliseconds
     */
    removeClassWithAnimation: (element: HTMLElement, className: string, duration: number = 300): void => {
        element.classList.add('fade-out');
        setTimeout(() => {
            element.classList.remove(className, 'fade-out');
        }, duration);
    }
    ,
    /**
     * Trigger download of a text file with given contents and filename
     */
    downloadTextFile: (text: string, filename: string) => {
        try {
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            console.error('DomUtils.downloadTextFile error', e);
        }
    }
};