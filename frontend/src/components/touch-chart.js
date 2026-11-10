export const TOUCH_HOLD_MS = 420;
export const TOUCH_SLOP = 9;

const control = 'button, a, summary, input, select, textarea, [role="button"]';

/** Own touch inside the plot. The renderer retains mouse, keyboard and legend input. */
export function bindTouchChart(element, {hit, inspect, compare, clear, navigate, rangeReadout, enabled = () => true, axis = 'x'}) {
  let contact = null;
  let pair = null;
  let multiple = false;
  let timer;
  let activeReadout;
  let svgMarker;
  let suppressClick = false;
  const priorTouchAction = element.style.touchAction;
  element.style.touchAction = 'pan-y';
  element.dataset.quantTouchChart = '';

  function local(touch) {
    const bounds = element.getBoundingClientRect();
    return [touch.clientX - bounds.left, touch.clientY - bounds.top];
  }

  function resetContact(cancelled = false) {
    clearTimeout(timer);
    delete element.dataset.quantGesture;
    svgMarker?.remove();
    activeReadout?.removeAttribute('data-quant-live-range');
    svgMarker = activeReadout = null;
    if (cancelled && contact?.mode === 'compare') clear?.();
    contact = null;
  }

  function geometry(touches) {
    const [a, b] = Array.from(touches, local);
    return {center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], distance: Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1]))};
  }

  function start(event) {
    if (!enabled() || event.target?.closest?.(control)) return;
    if (event.touches.length !== 1) {
      if (!contact && !multiple) return;
      multiple = true;
      resetContact(true);
      suppressClick = true;
      pair = event.touches.length === 2 && navigate ? geometry(event.touches) : null;
      event.stopImmediatePropagation();
      if (pair && event.cancelable) event.preventDefault();
      return;
    }
    suppressClick = false;
    const touch = event.touches[0];
    const point = local(touch);
    const value = hit(point, false);
    if (value == null) return;
    contact = {id: touch.identifier, point, value, last: value, mode: 'pending'};
    event.stopImmediatePropagation();
    if (compare) timer = setTimeout(() => {
      if (contact?.mode !== 'pending') return;
      contact.mode = 'armed';
      element.dataset.quantGesture = 'armed';
      element.style.setProperty('--qs-gesture-x', `${point[0]}px`);
      element.style.setProperty('--qs-gesture-y', `${point[1]}px`);
      if (element.namespaceURI === 'http://www.w3.org/2000/svg' && element.createSVGPoint) {
        const matrix = element.getScreenCTM();
        if (!matrix) return;
        const anchor = element.createSVGPoint();
        anchor.x = touch.clientX;
        anchor.y = touch.clientY;
        const p = anchor.matrixTransform(matrix.inverse());
        svgMarker = element.ownerDocument.createElementNS(element.namespaceURI, 'circle');
        svgMarker.setAttribute('cx', p.x);
        svgMarker.setAttribute('cy', p.y);
        svgMarker.setAttribute('r', '7');
        svgMarker.setAttribute('class', 'quant-gesture-marker');
        element.append(svgMarker);
      }
    }, TOUCH_HOLD_MS);
  }

  function move(event) {
    if (pair && event.touches.length === 2) {
      event.stopImmediatePropagation();
      if (event.cancelable) event.preventDefault();
      const next = geometry(event.touches);
      navigate(pair, next);
      pair = next;
      return;
    }
    if (multiple) {
      event.stopImmediatePropagation();
      return;
    }
    if (!contact) return;
    const touch = Array.from(event.touches).find(touch => touch.identifier === contact.id);
    if (!touch) return;
    const point = local(touch);
    event.stopImmediatePropagation();
    if (contact.mode === 'pending' || contact.mode === 'armed') {
      const dx = Math.abs(point[0] - contact.point[0]);
      const dy = Math.abs(point[1] - contact.point[1]);
      if (Math.max(dx, dy) < TOUCH_SLOP) return;
      clearTimeout(timer);
      svgMarker?.remove();
      // An early vertical gesture belongs to the page, even on vertical category charts.
      if (dy > dx && (contact.mode === 'pending' || axis !== 'y')) {
        contact.mode = 'scroll';
        delete element.dataset.quantGesture;
        return;
      }
      contact.mode = contact.mode === 'armed' ? 'compare' : 'inspect';
      element.dataset.quantGesture = contact.mode;
      if (contact.mode === 'inspect') clear?.();
      else {
        activeReadout = rangeReadout?.();
        activeReadout?.setAttribute('data-quant-live-range', '');
      }
    }
    if (contact.mode === 'scroll') return;
    if (event.cancelable) event.preventDefault();
    const value = hit(point, true);
    if (value == null || (value === contact.last && contact.sent)) return;
    contact.last = value;
    contact.sent = true;
    if (contact.mode === 'compare') compare(contact.value, value);
    else inspect?.(value, point);
  }

  function end(event) {
    if (multiple) {
      event.stopImmediatePropagation();
      if (event.touches.length < 2) pair = null;
      if (event.touches.length === 0) multiple = false;
    }
    if (!contact || !Array.from(event.changedTouches).some(touch => touch.identifier === contact.id)) return;
    event.stopImmediatePropagation();
    const cancelled = event.type === 'touchcancel';
    suppressClick = true;
    if (!cancelled && contact.mode === 'pending') {
      clear?.();
      inspect?.(contact.value, contact.point);
    }
    resetContact(cancelled);
  }

  function click(event) {
    if (!suppressClick || event.detail === 0 || event.target?.closest?.(control)) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function contextMenu(event) {
    if (contact) event.preventDefault();
  }

  // Some renderers listen to touch events and others listen to pointer events.
  function touchPointer(event) {
    if (event.pointerType !== 'touch' || !enabled() || event.target?.closest?.(control)) return;
    if (contact || multiple || hit(local(event), false) != null) event.stopImmediatePropagation();
  }

  function mouseStart(event) {
    if (event.pointerType !== 'touch') suppressClick = false;
    touchPointer(event);
  }

  const handlers = {touchstart: start, touchmove: move, touchend: end, touchcancel: end, click, contextmenu: contextMenu,
    pointerdown: mouseStart, pointermove: touchPointer, pointerup: touchPointer, pointercancel: touchPointer};
  for (const [type, handler] of Object.entries(handlers)) element.addEventListener(type, handler, {capture: true, passive: false});
  return () => {
    resetContact();
    for (const [type, handler] of Object.entries(handlers)) element.removeEventListener(type, handler, true);
    element.style.touchAction = priorTouchAction;
    element.style.removeProperty('--qs-gesture-x');
    element.style.removeProperty('--qs-gesture-y');
    delete element.dataset.quantTouchChart;
  };
}

/** Percent window anchored at the old plot position, with two-finger translation. */
export function navigateChartWindow(start, end, previous, next, origin, length, axis = 0, minSpan = 2) {
  if (length <= 0) return {start, end};
  const position = center => {
    const fraction = Math.max(0, Math.min(1, (center[axis] - origin) / length));
    return axis === 1 ? 1 - fraction : fraction;
  };
  const span = end - start;
  const width = Math.max(minSpan, Math.min(100, span * previous.distance / next.distance));
  const left = Math.max(0, Math.min(100 - width, start + position(previous.center) * span - position(next.center) * width));
  return {start: left, end: left + width};
}

export function navigateECharts(chart, previous, next, minSpan) {
  const zoom = chart.getOption().dataZoom || [];
  const grid = chart.getModel().getComponent('grid', 0).coordinateSystem.getRect();
  const batch = zoom.flatMap((window, dataZoomIndex) => {
    const vertical = window.xAxisIndex == null && window.yAxisIndex != null;
    const {start, end} = navigateChartWindow(window.start, window.end, previous, next,
      vertical ? grid.y : grid.x, vertical ? grid.height : grid.width, vertical ? 1 : 0, minSpan);
    return start === window.start && end === window.end ? [] : [{dataZoomIndex, start, end}];
  });
  if (batch.length) chart.dispatchAction({type: 'dataZoom', batch});
}
