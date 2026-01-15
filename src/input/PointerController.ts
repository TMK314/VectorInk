// input/PointerController.ts
import { InkRenderer } from '../renderer/InkRenderer';
import { InkDocument } from '../model/InkDocument';
import { InkView } from '../views/InkView';

export class PointerController {
  private renderer: InkRenderer;
  private document: InkDocument;
  private view: InkView;
  private isDrawing: boolean = false;
  private currentStroke: Array<{x: number, y: number, t: number, pressure: number}> = [];
  private currentStyle: any;
  
  constructor(renderer: InkRenderer, document: InkDocument, view: InkView) {
    this.renderer = renderer;
    this.document = document;
    this.view = view;
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    const svg = this.renderer['svg'];
    
    svg.addEventListener('pointerdown', this.onPointerDown.bind(this));
    svg.addEventListener('pointermove', this.onPointerMove.bind(this));
    svg.addEventListener('pointerup', this.onPointerUp.bind(this));
    svg.addEventListener('pointercancel', this.onPointerCancel.bind(this));
    
    // Prevent context menu
    svg.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Set CSS for better pointer events
    svg.style.touchAction = 'none';
  }
  
  private onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return; // Only left mouse button
    
    const rect = this.renderer['svg'].getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: Date.now(),
      pressure: event.pressure || 0.5
    };
    
    this.isDrawing = true;
    this.currentStroke = [point];
    this.currentStyle = { ...this.document.settings.defaultPen };
    
    // Set pointer capture
    event.preventDefault();
    this.renderer['svg'].setPointerCapture(event.pointerId);
  }
  
  private onPointerMove(event: PointerEvent): void {
    if (!this.isDrawing) return;
    
    const rect = this.renderer['svg'].getBoundingClientRect();
    const point = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      t: Date.now(),
      pressure: event.pressure || 0.5
    };
    
    this.currentStroke.push(point);
    
    // TODO: Render temporary stroke preview
  }
  
  private onPointerUp(event: PointerEvent): void {
  if (!this.isDrawing) return;
  
  this.isDrawing = false;
  this.renderer['svg'].releasePointerCapture(event.pointerId);
  
  // Finalize stroke if we have enough points
  if (this.currentStroke.length >= 2) {
    // Create a complete stroke object with the correct structure
    const strokeData = {
      points: this.currentStroke,
      style: this.currentStyle,
      // createdAt wird in addStroke automatisch gesetzt, also nicht hier angeben
      device: 'pen' as const
    };
    
    // Add the stroke to the document - nur 1 Argument!
    const stroke = this.document.addStroke(strokeData);
    
    // TODO: Auto-group into blocks based on proximity
    
    // Re-render
    this.renderer.render();
  }
  
  this.currentStroke = [];
}
  
  private onPointerCancel(event: PointerEvent): void {
    this.isDrawing = false;
    this.currentStroke = [];
    this.renderer['svg'].releasePointerCapture(event.pointerId);
  }
  
  cleanup(): void {
    const svg = this.renderer['svg'];
    svg.replaceWith(svg.cloneNode(true));
  }
}