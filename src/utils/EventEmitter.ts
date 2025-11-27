/**
 * Simple event emitter implementation for pub/sub pattern
 */
export class EventEmitter {
    private events: Record<string, Function[]>;

    constructor() {
        this.events = {};
    }

    /**
     * Register an event listener
     * @param event - Event name
     * @param callback - Callback function
     */
    on(event: string, callback: Function): void {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    /**
     * Remove an event listener
     * @param event - Event name
     * @param callback - Callback function to remove
     */
    off(event: string, callback: Function): void {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    }

    /**
     * Emit an event with optional arguments
     * @param event - Event name
     * @param args - Arguments to pass to listeners
     */
    emit(event: string, ...args: any[]): void {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`Error in event listener for '${event}':`, error);
            }
        });
    }

    /**
     * Register a one-time event listener
     * @param event - Event name
     * @param callback - Callback function (called once then removed)
     */
    once(event: string, callback: Function): void {
        const onceCallback = (...args: any[]) => {
            callback(...args);
            this.off(event, onceCallback);
        };
        this.on(event, onceCallback);
    }
}