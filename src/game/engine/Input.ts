// Input Manager - handles mouse and keyboard input (Converted to TypeScript)

import { MathUtils, EventEmitter } from '../../utils/Helpers';

// Type definitions
interface MousePosition {
    x: number;
    y: number;
}

interface TouchEvent {
    touches: TouchList;
    preventDefault(): void;
}

interface CameraBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

interface InputState {
    mousePos: MousePosition;
    mouseDown: boolean;
    isDragging: boolean;
    activeKeys: string[];
    camera: any;
}

// Input Manager class
export class InputManager extends EventEmitter {
    public canvas: HTMLCanvasElement;
    public renderer: any;
    public gameMap: any;

    // Input state
    public mousePos: MousePosition;
    public mouseDown: boolean;
    public dragStart: MousePosition | null;
    public isDragging: boolean;
    public dragThreshold: number;

    // Camera control
    public keys: Set<string>;
    public scrollSpeed: number;
    public zoomSpeed: number;

    // Optional camera bounds
    public cameraBounds: CameraBounds | null;
    public enabled: boolean;

    constructor(canvas: HTMLCanvasElement, renderer: any, gameMap: any) {
        super();

        this.canvas = canvas;
        this.renderer = renderer;
        this.gameMap = gameMap;

        // Input state
        this.mousePos = { x: 0, y: 0 };
        this.mouseDown = false;
        this.dragStart = null;
        this.isDragging = false;
        this.dragThreshold = 5;

        // Camera control
        this.keys = new Set();
        this.scrollSpeed = 50;
        this.zoomSpeed = 0.1;

        // Optional camera bounds
        this.cameraBounds = null;
        this.enabled = true;

        this.setupEventListeners();
    }

    setupEventListeners(): void {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e));
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));

        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));

        // Prevent context menu on canvas
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
    }

    // Mouse event handlers
    handleMouseDown(event: MouseEvent): void {
        if (!this.enabled) return;

        this.mouseDown = true;
        this.updateMousePos(event);

        this.dragStart = { ...this.mousePos };
        this.isDragging = false;

        // Right click for context menu
        if (event.button === 2) {
            this.handleRightClick();
        }
    }

    handleMouseMove(event: MouseEvent): void {
        if (!this.enabled) return;

        this.updateMousePos(event);

        if (this.mouseDown && this.dragStart) {
            const dragDistance = MathUtils.distance(
                this.mousePos.x, this.mousePos.y,
                this.dragStart.x, this.dragStart.y
            );

            if (!this.isDragging && dragDistance > this.dragThreshold) {
                this.isDragging = true;
                this.emit('dragStart', { start: this.dragStart, current: this.mousePos });
            }

            if (this.isDragging) {
                this.handleDrag();
            }
        } else {
            // Hover effects
            this.handleHover();
        }
    }

    handleMouseUp(event: MouseEvent): void {
        if (!this.enabled) return;

        if (this.isDragging) {
            this.emit('dragEnd', { start: this.dragStart, end: this.mousePos });
        } else if (event.button === 0) { // Left click
            this.handleClick();
        }

        this.mouseDown = false;
        this.dragStart = null;
        this.isDragging = false;
    }

    handleWheel(event: WheelEvent): void {
        if (!this.enabled) return;

        event.preventDefault();

        const zoomDelta = event.deltaY > 0 ? -this.zoomSpeed : this.zoomSpeed;
        this.renderer.zoomCamera(zoomDelta, this.mousePos.x, this.mousePos.y);

        this.emit('zoom', {
            delta: zoomDelta,
            centerX: this.mousePos.x,
            centerY: this.mousePos.y
        });
    }

    // Touch event handlers
    handleTouchStart(event: TouchEvent): void {
        if (!this.enabled) return;

        event.preventDefault();
        const touch = event.touches[0];
        this.handleMouseDown({
            clientX: touch.clientX,
            clientY: touch.clientY,
            button: 0
        } as MouseEvent);
    }

    handleTouchMove(event: TouchEvent): void {
        if (!this.enabled) return;

        event.preventDefault();
        const touch = event.touches[0];
        this.handleMouseMove({
            clientX: touch.clientX,
            clientY: touch.clientY
        } as MouseEvent);
    }

    handleTouchEnd(event: TouchEvent): void {
        if (!this.enabled) return;

        event.preventDefault();
        this.handleMouseUp({ button: 0 } as MouseEvent);
    }

    // Keyboard event handlers
    handleKeyDown(event: KeyboardEvent): void {
        if (!this.enabled) return;

        this.keys.add(event.code);

        // Camera movement
        this.updateCameraMovement();

        // Emit keyboard events for UI
        this.emit('keyDown', { code: event.code, key: event.key });
    }

    handleKeyUp(event: KeyboardEvent): void {
        if (!this.enabled) return;

        this.keys.delete(event.code);
        this.emit('keyUp', { code: event.code, key: event.key });
    }

    // Update mouse position relative to canvas
    updateMousePos(event: MouseEvent): void {
        const rect = this.canvas.getBoundingClientRect();
        this.mousePos.x = event.clientX - rect.left;
        this.mousePos.y = event.clientY - rect.top;
    }

    // Handle left click
    handleClick(): void {
        const worldPos = this.renderer.screenToWorld(this.mousePos);
        const hexCoords = this.renderer.grid.getHexAtPosition(worldPos.x, worldPos.y);

        if (hexCoords && this.renderer.grid.isValidHex(hexCoords.col, hexCoords.row)) {
            this.handleHexClick(hexCoords.col, hexCoords.row);
        }
    }

    // Handle right click
    handleRightClick(): void {
        // Show context menu or alternative action
        this.emit('rightClick', { pos: this.mousePos });
    }

    // Handle hex tile click
    handleHexClick(col: number, row: number): void {
        // Check for units on this tile
        const unit = this.gameMap.getUnitAt(col, row);
        const city = this.gameMap.getCityAt(col, row);

        const activeCiv = this.gameMap.activeCivilization;

        // Priority: Own units > Own cities > Move selected unit > Enemy units/cities
        if (unit && unit.civilization.id === activeCiv?.id) {
            this.emit('unitClicked', { unit, col, row });
        } else if (city && city.civilization.id === activeCiv?.id) {
            this.emit('cityClicked', { city, col, row });
        } else {
            // Try to move selected unit or attack
            this.emit('hexClicked', { col, row, unit, city });
        }
    }

    // Handle mouse hover
    handleHover(): void {
        const worldPos = this.renderer.screenToWorld(this.mousePos);
        const hexCoords = this.renderer.grid.getHexAtPosition(worldPos.x, worldPos.y);

        if (hexCoords && this.renderer.grid.isValidHex(hexCoords.col, hexCoords.row)) {
            this.emit('hexHover', { col: hexCoords.col, row: hexCoords.row });
        }
    }

    // Handle camera dragging
    handleDrag(): void {
        if (!this.dragStart) return;

        const deltaX = this.mousePos.x - this.dragStart.x;
        const deltaY = this.mousePos.y - this.dragStart.y;

        this.renderer.moveCamera(deltaX, deltaY);

        // Update drag start for smooth movement
        this.dragStart = { ...this.mousePos };

        this.emit('cameraMoved', { deltaX, deltaY });
    }

    // Update camera movement from keyboard
    updateCameraMovement(): void {
        let deltaX = 0;
        let deltaY = 0;

        if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) {
            deltaX += this.scrollSpeed;
        }
        if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) {
            deltaX -= this.scrollSpeed;
        }
        if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) {
            deltaY += this.scrollSpeed;
        }
        if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) {
            deltaY -= this.scrollSpeed;
        }

        if (deltaX !== 0 || deltaY !== 0) {
            this.renderer.moveCamera(deltaX, deltaY);
            this.emit('cameraMoved', { deltaX, deltaY });
        }
    }

    // Handle window resize
    handleResize(): void {
        // Update canvas size
        this.renderer.setupCanvas();
        this.emit('resize');
    }

    // Center camera on position
    centerOn(col: number, row: number): void {
        const worldPos = this.renderer.grid.hexToScreen(col, row);
        const canvasCenter = {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2
        };

        this.renderer.setCamera(
            canvasCenter.x - worldPos.x,
            canvasCenter.y - worldPos.y,
            this.renderer.camera.zoom
        );

        this.emit('cameraCentered', { col, row });
    }

    // Get hex coordinates at screen position
    getHexAtScreen(screenX: number, screenY: number): any {
        const worldPos = this.renderer.screenToWorld({ x: screenX, y: screenY });
        return this.renderer.grid.getHexAtPosition(worldPos.x, worldPos.y);
    }

    // Get screen position of hex
    getScreenPos(col: number, row: number): any {
        const worldPos = this.renderer.grid.hexToScreen(col, row);
        return this.renderer.worldToScreen(worldPos);
    }

    // Check if hex is visible on screen
    isHexVisible(col: number, row: number): boolean {
        const screenPos = this.getScreenPos(col, row);
        return screenPos.x >= -50 && screenPos.x <= this.canvas.width + 50 &&
               screenPos.y >= -50 && screenPos.y <= this.canvas.height + 50;
    }

    // Smooth camera movement to position
    panTo(col: number, row: number, duration: number = 500): void {
        const startPos = { ...this.renderer.camera };
        const worldPos = this.renderer.grid.hexToScreen(col, row);
        const canvasCenter = {
            x: this.canvas.width / 2,
            y: this.canvas.height / 2
        };

        const endPos = {
            x: canvasCenter.x - worldPos.x,
            y: canvasCenter.y - worldPos.y,
            zoom: this.renderer.camera.zoom
        };

        const startTime = performance.now();

        const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Easing function (ease-out)
            const eased = 1 - Math.pow(1 - progress, 3);

            const currentX = MathUtils.lerp(startPos.x, endPos.x, eased);
            const currentY = MathUtils.lerp(startPos.y, endPos.y, eased);

            this.renderer.setCamera(currentX, currentY, endPos.zoom);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                this.emit('panComplete', { col, row });
            }
        };

        requestAnimationFrame(animate);
    }

    // Set camera bounds (optional feature)
    setCameraBounds(minX: number, maxX: number, minY: number, maxY: number): void {
        this.cameraBounds = { minX, maxX, minY, maxY };
    }

    // Enforce camera bounds
    enforceCameraBounds(): void {
        if (!this.cameraBounds) return;

        const camera = this.renderer.camera;
        const bounds = this.cameraBounds;

        if (camera.x < bounds.minX) camera.x = bounds.minX;
        if (camera.x > bounds.maxX) camera.x = bounds.maxX;
        if (camera.y < bounds.minY) camera.y = bounds.minY;
        if (camera.y > bounds.maxY) camera.y = bounds.maxY;
    }

    // Enable/disable input
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    }

    // Update method for continuous input processing
    update(deltaTime: number): void {
        // Update camera movement from held keys
        this.updateCameraMovement();

        // Enforce camera bounds if set
        this.enforceCameraBounds();
    }

    // Get input state for debugging
    getState(): InputState {
        return {
            mousePos: this.mousePos,
            mouseDown: this.mouseDown,
            isDragging: this.isDragging,
            activeKeys: Array.from(this.keys),
            camera: this.renderer.camera
        };
    }
}