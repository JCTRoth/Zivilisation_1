import React, { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '../../stores/gameStore';

const GameCanvas = ({ gameEngine }) => {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastRenderTime = useRef(0);
  
  const camera = useGameStore(state => state.camera);
  const gameState = useGameStore(state => state.gameState);
  const actions = useGameStore(state => state.actions);
  
  // Mouse and touch interaction state
  const mouseState = useRef({
    isDragging: false,
    lastX: 0,
    lastY: 0,
    dragStartX: 0,
    dragStartY: 0,
    initialPinchDistance: 0,
    lastPinchDistance: 0,
    isPinching: false
  });

  // Render loop
  const render = useCallback((timestamp) => {
    const canvas = canvasRef.current;
    if (!canvas || !gameEngine) return;

    const deltaTime = timestamp - lastRenderTime.current;
    lastRenderTime.current = timestamp;

    // Clear canvas
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set up camera transform
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Render game world
    gameEngine.render(ctx, camera);

    ctx.restore();

    // Continue animation loop
    animationFrameRef.current = requestAnimationFrame(render);
  }, [gameEngine, camera]);

  // Initialize canvas and start render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set canvas size
    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start render loop
    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [render]);

  // Handle mouse and touch events
  const getEventPos = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const getPinchDistance = (event) => {
    if (!event.touches || event.touches.length < 2) return 0;
    
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    
    return Math.sqrt(
      Math.pow(touch2.clientX - touch1.clientX, 2) +
      Math.pow(touch2.clientY - touch1.clientY, 2)
    );
  };

  const getPinchCenter = (event) => {
    if (!event.touches || event.touches.length < 2) return { x: 0, y: 0 };
    
    const rect = canvasRef.current.getBoundingClientRect();
    const touch1 = event.touches[0];
    const touch2 = event.touches[1];
    
    return {
      x: ((touch1.clientX + touch2.clientX) / 2) - rect.left,
      y: ((touch1.clientY + touch2.clientY) / 2) - rect.top
    };
  };

  const handleMouseDown = useCallback((event) => {
    // Handle pinch gestures on touch devices
    if (event.touches && event.touches.length === 2) {
      mouseState.current.isPinching = true;
      mouseState.current.initialPinchDistance = getPinchDistance(event);
      mouseState.current.lastPinchDistance = mouseState.current.initialPinchDistance;
      mouseState.current.isDragging = false;
    } else {
      const pos = getEventPos(event);
      
      mouseState.current.isDragging = true;
      mouseState.current.isPinching = false;
      mouseState.current.lastX = pos.x;
      mouseState.current.lastY = pos.y;
      mouseState.current.dragStartX = pos.x;
      mouseState.current.dragStartY = pos.y;
    }
    
    event.preventDefault();
  }, []);

  const handleMouseMove = useCallback((event) => {
    // Handle pinch zoom
    if (mouseState.current.isPinching && event.touches && event.touches.length === 2) {
      const currentDistance = getPinchDistance(event);
      const center = getPinchCenter(event);
      
      if (mouseState.current.lastPinchDistance > 0) {
        const scaleFactor = currentDistance / mouseState.current.lastPinchDistance;
        const newZoom = Math.max(
          camera.minZoom, 
          Math.min(camera.maxZoom, camera.zoom * scaleFactor)
        );
        
        // Zoom towards pinch center
        const worldCenterX = (center.x / camera.zoom) + camera.x;
        const worldCenterY = (center.y / camera.zoom) + camera.y;
        
        const newWorldCenterX = (center.x / newZoom) + camera.x;
        const newWorldCenterY = (center.y / newZoom) + camera.y;
        
        actions.updateCamera({
          zoom: newZoom,
          x: camera.x + (worldCenterX - newWorldCenterX),
          y: camera.y + (worldCenterY - newWorldCenterY)
        });
      }
      
      mouseState.current.lastPinchDistance = currentDistance;
    } else if (mouseState.current.isDragging) {
      const pos = getEventPos(event);
      const deltaX = (pos.x - mouseState.current.lastX) / camera.zoom;
      const deltaY = (pos.y - mouseState.current.lastY) / camera.zoom;
      
      actions.updateCamera({
        x: camera.x - deltaX,
        y: camera.y - deltaY
      });
      
      mouseState.current.lastX = pos.x;
      mouseState.current.lastY = pos.y;
    }
    
    event.preventDefault();
  }, [camera, actions]);

  const handleMouseUp = useCallback((event) => {
    if (mouseState.current.isPinching) {
      mouseState.current.isPinching = false;
      mouseState.current.initialPinchDistance = 0;
      mouseState.current.lastPinchDistance = 0;
    } else if (mouseState.current.isDragging) {
      const pos = getEventPos(event);
      
      // Check if this was a click (small movement) rather than a drag
      const dragDistance = Math.sqrt(
        Math.pow(pos.x - mouseState.current.dragStartX, 2) +
        Math.pow(pos.y - mouseState.current.dragStartY, 2)
      );
      
      // Increase threshold for touch devices
      const threshold = event.touches || event.changedTouches ? 15 : 5;
      
      if (dragDistance < threshold) {
        // This was a click/tap, not a drag
        handleCanvasClick(event);
      }
    }
    
    mouseState.current.isDragging = false;
  }, []);

  const handleCanvasClick = useCallback((event) => {
    if (!gameEngine) return;
    
    const pos = getEventPos(event);
    
    // Convert screen coordinates to world coordinates
    const worldX = (pos.x / camera.zoom) + camera.x;
    const worldY = (pos.y / camera.zoom) + camera.y;
    
    // Get hex coordinates
    const hex = gameEngine.screenToHex(worldX, worldY);
    
    console.log(`[CLICK] Canvas click at screen (${pos.x}, ${pos.y}) -> world (${worldX.toFixed(1)}, ${worldY.toFixed(1)}) -> hex (${hex.col}, ${hex.row})`);
    
    if (gameEngine.isValidHex(hex.col, hex.row)) {
      // Handle hex selection
      actions.selectHex(hex);
      
      // Check for unit or city at this location
      const unit = gameEngine.getUnitAt(hex.col, hex.row);
      const city = gameEngine.getCityAt(hex.col, hex.row);
      
      if (unit) {
        console.log(`[CLICK] Selected unit ${unit.id} (${unit.type}) at (${hex.col}, ${hex.row})`);
        actions.selectUnit(unit.id);
      } else if (city) {
        console.log(`[CLICK] Selected city ${city.id} (${city.name}) at (${hex.col}, ${hex.row})`);
        actions.selectCity(city.id);
      } else {
        // Try to move selected unit
        if (gameState.selectedUnit) {
          console.log(`[CLICK] Attempting to move selected unit ${gameState.selectedUnit} to (${hex.col}, ${hex.row})`);
          const result = gameEngine.moveUnit(gameState.selectedUnit, hex.col, hex.row);
          if (!result || !result.success) {
            const reason = result?.reason || 'unknown';
            console.log('[GameCanvas] Move failed:', reason);
            actions.addNotification({ type: 'warning', message: 
              reason === 'no_moves_left' ? 'Move failed: no moves left' :
              reason === 'terrain_impassable' ? 'Move failed: terrain is impassable' :
              reason === 'insufficient_moves' ? 'Move failed: insufficient movement points' :
              'Move failed'
            });
          }
        } else {
          console.log(`[CLICK] Empty hex clicked at (${hex.col}, ${hex.row}) - no unit or city selected`);
        }
      }
    } else {
      console.log(`[CLICK] Invalid hex clicked at (${hex.col}, ${hex.row})`);
    }
  }, [gameEngine, camera, actions, gameState.selectedUnit]);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Calculate zoom
    const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(camera.minZoom, Math.min(camera.maxZoom, camera.zoom * zoomFactor));
    
    // Zoom towards mouse position
    const worldMouseX = (mouseX / camera.zoom) + camera.x;
    const worldMouseY = (mouseY / camera.zoom) + camera.y;
    
    const newWorldMouseX = (mouseX / newZoom) + camera.x;
    const newWorldMouseY = (mouseY / newZoom) + camera.y;
    
    actions.updateCamera({
      zoom: newZoom,
      x: camera.x + (worldMouseX - newWorldMouseX),
      y: camera.y + (worldMouseY - newWorldMouseY)
    });
  }, [camera, actions]);

  // Handle right-click for context menu
  const handleContextMenu = useCallback((event) => {
    event.preventDefault();
    
    const pos = getEventPos(event);
    
    // Convert to world coordinates and get hex
    const worldX = (pos.x / camera.zoom) + camera.x;
    const worldY = (pos.y / camera.zoom) + camera.y;
    const hex = gameEngine.screenToHex(worldX, worldY);
    
    if (gameEngine.isValidHex(hex.col, hex.row)) {
      // Show context menu for hex
      // This could open a modal or dropdown with actions
      console.log('Right-click on hex:', hex);
    }
  }, [gameEngine, camera]);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas w-100 h-100"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      style={{ 
        cursor: mouseState.current?.isDragging ? 'grabbing' : 'crosshair',
        touchAction: 'none' // Prevent default touch behaviors
      }}
    />
  );
};

export default GameCanvas;