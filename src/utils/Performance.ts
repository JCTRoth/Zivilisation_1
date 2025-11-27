/**
 * Performance monitoring utilities
 */

export const Performance = {
    startTime: 0,

    /**
     * Start performance timing
     * @param label - Label for the timing operation
     */
    start: (label: string): void => {
        Performance.startTime = performance.now();
        console.time(label);
    },

    /**
     * End performance timing and return duration
     * @param label - Label for the timing operation
     * @returns Duration in milliseconds
     */
    end: (label: string): number => {
        const endTime = performance.now();
        const duration = endTime - Performance.startTime;
        console.timeEnd(label);
        return duration;
    },

    /**
     * Measure execution time of a function
     * @param fn - Function to measure
     * @param label - Label for the measurement
     * @returns Result of the function execution
     */
    measure: <T>(fn: () => T, label: string = 'Operation'): T => {
        Performance.start(label);
        const result = fn();
        Performance.end(label);
        return result;
    }
};