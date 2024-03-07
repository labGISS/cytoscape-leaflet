import L, { PointTuple } from 'leaflet';
import { MapHandlerOptions } from './types';
import { isMultSelKeyDown, assign } from './utils';
import { EventObject } from 'cytoscape';

const DEFAULT_FIT_PADDING: PointTuple = [50, 50];
const DEFAULT_ANIMATION_DURATION = 1;
const HIDDEN_CLASS = 'cytoscape-map__hidden';

const DEFAULT_MAP_MOVE_DELAY = 0;

const DEFAULT_LAYOUT = {
  name: 'preset',
}

export class MapHandler {
  cy: cytoscape.Core | undefined;
  mapOptions: L.MapOptions;
  options: MapHandlerOptions | undefined;

  mapContainer: HTMLElement | undefined;
  map: L.Map | undefined;

  originalAutoungrabify: boolean | undefined;
  originalUserZoomingEnabled: boolean | undefined;
  originalUserPanningEnabled: boolean | undefined;

  originalPositions: cytoscape.NodePositionMap | undefined;
  originalZoom: number | undefined;
  originalPan: cytoscape.Position | undefined;

  panning: boolean = false;

  requestAnimationId: number | undefined;

  onGraphContainerMouseDownBound = this.onGraphContainerMouseDown.bind(this);
  onGraphContainerMouseMoveBound = this.onGraphContainerMouseMove.bind(this);
  onGraphContainerWheelBound = this.onGraphContainerWheel.bind(this);
  onMapMoveBound = this.onMapMove.bind(this);
  // onMapMoveStartBound = this.onMapMoveStart.bind(this);
  onMapMoveEndBound = this.onMapMoveEnd.bind(this);

  onGraphAddBound = this.onGraphAdd.bind(this);
  onGraphResizeBound = this.onGraphResize.bind(this);
  onGraphDragFreeBound = this.onGraphDragFree.bind(this);
  onDataChangeBound = this.onDataChange.bind(this);

  saveLayoutPositionAsLatLngBound = this.saveLayoutPositionAsLatLng.bind(this);

  /**
   * @param {cytoscape.Core} cy
   * @param {L.MapOptions} mapOptions
   * @param {MapHandlerOptions} options
   */
  constructor(
    cy: cytoscape.Core,
    mapOptions: L.MapOptions,
    options: MapHandlerOptions
  ) {
    this.cy = cy;
    this.mapOptions = mapOptions;
    this.options = options;

    if (!(typeof this.options.getPosition === 'function')) {
      throw new Error('getPosition should be a function');
    }
    if (
      this.options.setPosition &&
      !(typeof this.options.setPosition === 'function')
    ) {
      throw new Error('setPosition should be a function');
    }

    // Cytoscape config
    this.originalAutoungrabify = this.cy.autoungrabify();
    this.originalUserZoomingEnabled = this.cy.userZoomingEnabled();
    this.originalUserPanningEnabled = this.cy.userPanningEnabled();

    this.cy.userZoomingEnabled(false);
    this.cy.userPanningEnabled(false);

    // Cytoscape events
    const graphContainer = this.cy.container() as unknown as HTMLElement;
    // graphContainer.addEventListener(
    //   'mousedown',
    //   this.onGraphContainerMouseDownBound
    // );
    // graphContainer.addEventListener(
    //   'mousemove',
    //   this.onGraphContainerMouseMoveBound
    // );
    this.cy.on('tapstart', this.onGraphContainerMouseDownBound);

    graphContainer.addEventListener('wheel', this.onGraphContainerWheelBound);
    this.cy.on('add', this.onGraphAddBound);
    this.cy.on('resize', this.onGraphResizeBound);
    this.cy.on('dragfree', this.onGraphDragFreeBound);
    this.cy.on('cxttap', "node", function(event) {
      event.target.unlock();
    });
    this.cy.on('data', this.onDataChangeBound);

    // this.cy.on('layoutstart layoutready layoutstop ready render destroy pan dragpan zoom pinchzoom scrollzoom viewport resize', (evt) => {
    //   console.log(evt.type);
    // })
    //
    // this.cy.one('render', (evt) => {
    //   console.log(evt);
    // })

    // Map container
    this.mapContainer = document.createElement('div');
    this.mapContainer.style.position = 'absolute';
    this.mapContainer.style.top = '0px';
    this.mapContainer.style.left = '0px';
    this.mapContainer.style.width = '100%';
    this.mapContainer.style.height = '100%';

    graphContainer?.prepend(this.mapContainer);

    // Leaflet instance
    this.map = new L.Map(this.mapContainer, this.mapOptions);
    this.fit(undefined, { padding: DEFAULT_FIT_PADDING, animate: false });

    // Map events
    this.map.on('move', this.onMapMoveBound);
    // this.map.on('movestart', this.onMapMoveStartBound);
    this.map.on('moveend', this.onMapMoveEndBound);

    // Cytoscape unit viewport
    this.originalZoom = this.cy.zoom();
    this.originalPan = { ...this.cy.pan() };

    const zoom = 1;
    const pan = { x: 0, y: 0 };

    if (this.options.animate) {
      this.cy.animate(
        {
          zoom: zoom,
          pan: pan,
        },
        {
          duration:
            this.options.animationDuration ?? DEFAULT_ANIMATION_DURATION,
          easing: 'linear',
        }
      );
    } else {
      this.cy.viewport({ zoom, pan });
    }

    // Cytoscape positions
    this.enableGeographicPositions();
  }

  destroy() {
    // Cytoscape events
    const graphContainer = this.cy?.container();
    if (graphContainer) {
      // graphContainer.removeEventListener(
      //   'mousedown',
      //   this.onGraphContainerMouseDownBound
      // );
      // graphContainer.removeEventListener(
      //   'mousemove',
      //   this.onGraphContainerMouseMoveBound
      // );
      graphContainer.removeEventListener(
        'wheel',
        this.onGraphContainerWheelBound
      );
    }
    if (this.cy) {
      this.cy.off('tapstart', this.onGraphContainerMouseDownBound);
      this.cy.off('add', this.onGraphAddBound);
      this.cy.off('resize', this.onGraphResizeBound);
      this.cy.off('dragfree', this.onGraphDragFreeBound);
      this.cy.off('data', this.onDataChangeBound);

      // Cytoscape config
      this.cy.autoungrabify(this.originalAutoungrabify);
      this.cy.userZoomingEnabled(this.originalUserZoomingEnabled);
      this.cy.userPanningEnabled(this.originalUserPanningEnabled);
    }
    this.originalAutoungrabify = undefined;
    this.originalUserZoomingEnabled = undefined;
    this.originalUserPanningEnabled = undefined;

    // Map events
    this.map?.off('move', this.onMapMoveBound);
    // this.map?.off('dragstart', this.onMapDragStartBound);
    this.map?.off('dragend');

    // Map instance
    this.map?.remove();
    this.map = undefined;

    // Map container
    this.mapContainer?.remove();
    this.mapContainer = undefined;

    // Cytoscape unit viewport
    if (this.options?.animate) {
      this.cy?.animate(
        {
          zoom: this.originalZoom,
          pan: this.originalPan,
        },
        {
          duration:
            this.options.animationDuration ?? DEFAULT_ANIMATION_DURATION,
          easing: 'linear',
        }
      );
    } else {
      this.cy?.viewport({
        zoom: this.originalZoom ?? 5,
        pan:
          this.originalPan ??
          ({
            x: 0,
            y: 0,
          } as cytoscape.Position),
      });
    }

    this.originalZoom = undefined;
    this.originalPan = undefined;

    // Cytoscape positions
    this.disableGeographicPositions();

    this.cy = undefined;
    this.options = undefined;
  }

  /**
   * @param {cytoscape.NodeCollection} nodes
   * @param {L.FitBoundsOptions} options
   */
  fit(
    nodes: cytoscape.NodeCollection = this.cy?.nodes() ??
      ([] as unknown as cytoscape.NodeCollection),
    options: L.FitBoundsOptions
  ) {
    const bounds = this.getNodeLngLatBounds(nodes);
    if (!bounds.isValid()) {
      return;
    }

    this.map?.fitBounds(bounds, options);
  }

  /**
   * Save each node current layout position as the current geographical position.
   * Node's position is saved into its scratch, as <i>leaflet</i> namespace and <i>currentGeoposition<i> LatLng object
   * @param {cytoscape.NodeCollection} nodes
   */
  saveLayoutPositionAsLatLng(nodes = this.cy?.nodes()) {
    nodes?.forEach((node) => {
        // if (!(node.scratch('leaflet') && node.scratch('leaflet')['currentGeoposition'])) {
        // @ts-ignore
      node.scratch('leaflet', {currentGeoposition: this.map?.containerPointToLatLng(node.position())})
        // }
      }
    );

  }

  /**
   * Delete layout geographic position from each node's scratch
   * @param nodes
   */
  deleteLatLngLayoutPosition(nodes= this.cy?.nodes()) {
    nodes?.forEach((node) => {
      if (node.scratch('leaflet') && node.scratch('leaflet').currentGeoposition) {
        delete node.scratch('leaflet').currentGeoposition;
      }
    });
  }

  /**
   * Update nodes positions (calling node.position() method)
   * and (optionally) hide nodes without geographical position
   * @private
   */
  updateNodePosition(nodes = this.cy?.nodes()) {
    nodes?.forEach((node) => {

      // let wasLocked = node.locked();

      // if (wasLocked) node.unlock();

      node.unlock();
      let position = this.getGeographicPosition(node);
      if(position) {
        node.position(position);
        // if (this.getNodeLngLat(node)) { // nodes that have native geographical positions cannot be dragged
        node.lock();
        // }
      }

      // hide nodes without position
      if (!position && this.options?.hideNonPositional) {
        // const nodesWithoutPosition = nodes.filter(node => !positions[node.id()]);
        node.addClass(HIDDEN_CLASS).style('display', 'none');
      }
    });
  }

  /**
   * @return {cytoscape.LayoutOptions}
   * @param {*} [customOptions]
   */
  getLayout(customOptions: any = undefined) {
    return assign(DEFAULT_LAYOUT, this.options?.layout, customOptions);
  }

  /**
   * @private
   */
  private enableGeographicPositions() {
    const nodes: cytoscape.NodeCollection =
      this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection);

    this.originalPositions = Object.fromEntries(
      nodes.map((node) => {
        return [node.id(), { ...node.position() }];
      })
    );

    /*
    const positions: cytoscape.NodePositionMap = Object.fromEntries(
      nodes
        .map((node) => {
          return [node.id(), this.getGeographicPosition(node)];
        })
        .filter(([_id, position]) => {
          return !!position;
        })
    );
    */
    /*
    this.cy
      ?.elements().makeLayout(this.getLayout({
      fit: false,
      animate: this.options?.animate,
      animationDuration: this.options?.animationDuration ?? DEFAULT_ANIMATION_DURATION,
      animationEasing: 'ease-out-cubic',
    }))
      // .one('layoutstop', this.saveLayoutPositionAsLatLngBound)
      .run();
    */

    this.cy?.nodes().forEach((node) => {
      if (this.getNodeLngLat(node)) {
        node.lock();
      }
    });

    this.updateNodePosition(nodes);
  }

  /**
   * @private
   * @param {cytoscape.NodeCollection | undefined} nodes
   */
  private updateGeographicPositions(
    nodes = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
   /* const updatePositions = (
      nodes = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
    ) => {
      const positions: cytoscape.NodePositionMap = Object.fromEntries(
        nodes
          .map((node) => {
            return [node.id(), this.getGeographicPosition(node)];
          })
          .filter(([_id, position]) => {
            return !!position;
          })
      );

      // update only positions which have changed, for cytoscape-edgehandles compatibility
      const currentPositions: cytoscape.NodePositionMap = Object.fromEntries(
        nodes.map((node) => {
          return [node.id(), { ...node.position() }];
        })
      );
      const updatedPositions = getUpdatedPositionsMemo(
        currentPositions,
        positions
      );

      // hide nodes without position
      const nodesWithoutPosition = nodes.filter(
        (node) => !positions[node.id()]
      );
      nodesWithoutPosition.addClass(HIDDEN_CLASS).style('display', 'none');

      this.cy
        ?.layout({
          name: 'preset',
          positions: updatedPositions,
          fit: false,
        })
        .run();
    };

    this.requestAnimationId = window.requestAnimationFrame(
      function animatedUpdateGeographicPositions() {
        updatePositions(nodes);
      }
    );*/

    this.updateNodePosition(nodes);
  }

  /**
   * @private
   */
  private disableGeographicPositions() {
    const nodes =
      this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection);

/*    this.cy
      ?.layout({
        name: 'preset',
        positions: this.originalPositions,
        fit: false,
        animate: this.options?.animate,
        animationDuration:
          this.options?.animationDuration ?? DEFAULT_ANIMATION_DURATION,
        animationEasing: 'ease-in-cubic',
        stop: () => {
          // show nodes without position
          const nodesWithoutPosition = nodes.filter((node) =>
            node.hasClass(HIDDEN_CLASS)
          );
          nodesWithoutPosition.removeClass(HIDDEN_CLASS).style('display', null);
        },
      })
      .run();*/

    // show nodes without position
    if (this.options?.hideNonPositional) {
      const nodesWithoutPosition = nodes.filter(node => node.hasClass(HIDDEN_CLASS));
      nodesWithoutPosition.removeClass(HIDDEN_CLASS).style('display', null);
    }

    nodes.forEach((node) => {
      // if (this.originalPositions && this.originalPositions[node.id()]) {
      //   node.position(this.originalPositions[node.id()]);
      //   node.unlock();
      // }
      node.unlock();
    });

    this.cy?.fit();
    // this.cy.layout(this.getLayout({
    //   fit: false,
    //   animate: this.options.animate,
    //   animationDuration: this.options.animationDuration ?? DEFAULT_ANIMATION_DURATION,
    //   animationEasing: 'ease-in-cubic',
    //   stop: () => {
    //     // show nodes without position
    //     const nodesWithoutPosition = nodes.filter(node => node.hasClass(HIDDEN_CLASS));
    //     nodesWithoutPosition.removeClass(HIDDEN_CLASS).style('display', null);
    //   }
    // })).run();

    this.cy?.one('layoutstop', (evt) => {
      evt.cy.nodes().unlock();
    });

    this.originalPositions = undefined;
  }

  /**
   * @private
   * @param {EventObject} cyEventObject
   */
  private onGraphContainerMouseDown(cyEventObject: EventObject) {
    let originalEvent = cyEventObject.originalEvent;

    // @ts-ignore
    const renderer = this.cy?.renderer();
    if (
      this.cy &&
      originalEvent.buttons === 1 &&
      !isMultSelKeyDown(originalEvent) &&
      !renderer.hoverData.down
    ) {
/*      // @ts-ignore,
      if (this.cy) this.cy.renderer().hoverData.dragging = true; // cytoscape-lasso compatibility
      this.dispatchMapEvent(event);

      document.addEventListener(
        'mouseup',
        () => {
          if (!this.panning) {
            return;
          }

          this.panning = false;

          // @ts-ignore, prevent unselecting in Cytoscape mouseup
          if (this.cy) this.cy.renderer().hoverData.dragged = true;
        },
        { once: true }
      );*/

      // @ts-ignore
      this.cy.renderer().hoverData.dragging = true; // cytoscape-lasso compatibility

      this.saveLayoutPositionAsLatLng(cyEventObject.cy.nodes());
      this.dispatchMapEvent(originalEvent);

      // @ts-ignore
      this.cy.one('tapdrag', this.onGraphContainerMouseMoveBound);

      // this.cy.nodes('#London-NewYork1').on('position', (evt) => {
      //   let data = {
      //     position: evt.target.position(),
      //     rendered: evt.target.renderedPosition(),
      //     relative: evt.target.relativePosition()
      //   }
      //
      //   if (evt.target.scratch('leaflet')) {
      //     data['geoposition'] = evt.target.scratch('leaflet').currentGeoposition;
      //   }
      //
      //   console.table(data);
      // });

      // @ts-ignore
      cyEventObject.cy.one('tapend', (cyUpEventObject) => {
        // this.deleteLatLngLayoutPosition(cyUpEventObject.cy.nodes());
        // this.updateGeographicPositions(cyUpEventObject.cy.nodes());

        // console.warn("TAPEND");
        // setTimeout(()=>{
        //   this.cy.nodes('#London-NewYork1').off('position');
        // }, 500);

        if (!this.panning) {
          return;
        }

        this.panning = false;

        // @ts-ignore,  prevent unselecting in Cytoscape mouseup
        this.cy.renderer().hoverData.dragged = true;
      });
    }
  }

  /**
   * @private
   * @param {cytoscape.EventObject} cyEventObject
   */
  private onGraphContainerMouseMove(cyEventObject: EventObject) {
    const originalEvent = cyEventObject.originalEvent;
    // @ts-ignore
    const renderer = this.cy?.renderer();
    if (
      originalEvent.buttons === 1 &&
      !isMultSelKeyDown(originalEvent) &&
      !renderer.hoverData.down
    ) {
      this.panning = true;
      cyEventObject.preventDefault();
      this.dispatchMapEvent(originalEvent);
    }
  }

  /**
   * @private
   * @param {MouseEvent} event
   */
  private onGraphContainerWheel(event: MouseEvent) {
    event.preventDefault();
    this.dispatchMapEvent(event);
  }

  /**
   * @private
   */
  private onMapMove() {
    this.updateGeographicPositions();
  }

  /**
   * @private
   */
  private onDataChange() {
    this.updateGeographicPositions();
  }

  onMapMoveEnd() {
    // console.log("moveend");
    setTimeout(() => {
      this.cy?.nodes().forEach((node) => {

        if (!this.getNodeLngLat(node)) {
          // console.log("unlock");
          // this.updateNodePosition(node);
          node.unlock();
        }
      });
    }, this.options?.delayOnMove || DEFAULT_MAP_MOVE_DELAY);
  }

  /**
   * @private
   * @param {cytoscape.EventObject} event
   */
  private onGraphAdd(event: cytoscape.EventObject) {
    if (!event.target.isNode()) {
      return;
    }

    const node: cytoscape.NodeSingular = event.target;

    if (!this.originalPositions) this.originalPositions = {};
    this.originalPositions[node.id()] = { ...node.position() };

    const nodes = this.cy?.collection().merge(node);
    this.updateGeographicPositions(nodes);
  }

  /**
   * @private
   */
  private onGraphResize() {
    this.map?.invalidateSize(false);
  }

  /**
   * @private
   * @param {cytoscape.EventObject} event
   */
  private onGraphDragFree(event: cytoscape.EventObject) {
    const node: cytoscape.NodeSingular = event.target;

    if (this.options?.setPosition) {
      const { x, y } = node.position();
      const position: PointTuple = [x, y];
      const lngLat = this.map?.containerPointToLatLng(position);
      if (lngLat) this.options.setPosition(node, lngLat);
    }

    const nodes = this.cy?.collection().merge(node);
    this.updateGeographicPositions(nodes);
  }

  /**
   * @private
   * @param {MouseEvent} event
   */
  private dispatchMapEvent(event: MouseEvent) {
    if (
      event.target === this.mapContainer ||
      // @ts-ignore
      this.mapContainer?.contains(event.target)
    ) {
      return;
    }

    // @ts-ignore
    const clonedEvent = new event.constructor(event.type, event);
    this.map?.getContainer().dispatchEvent(clonedEvent);
  }

  /**
   * @private
   * @param {cytoscape.NodeSingular} node
   * @return {L.LatLng | undefined}
   */
  private getNodeLngLat(node: cytoscape.NodeSingular): L.LatLng | undefined {
    if (typeof this.options?.getPosition !== 'function') return;

    const lngLatLike = this.options?.getPosition(node);
    if (!lngLatLike) {
      return;
    }

    let lngLat;
    try {
      lngLat = L.latLng(lngLatLike);
    } catch (e) {
      return;
    }

    return lngLat;
  }

  /**
   * @private
   * @param {cytoscape.NodeCollection} nodes
   * @return {L.LatLngBounds}
   */
  private getNodeLngLatBounds(
    nodes: cytoscape.NodeCollection = this.cy?.nodes() ??
      ([] as unknown as cytoscape.NodeCollection)
  ): L.LatLngBounds {
    return nodes.reduce((bounds, node) => {
      const lngLat = this.getNodeLngLat(node);
      if (!lngLat) {
        return bounds;
      }

      return bounds.extend(lngLat);
    }, L.latLngBounds([]));
  }

  /**
   * @private
   * @param {cytoscape.NodeSingular} node
   * @return {cytoscape.Position | undefined}
   */
  private getGeographicPosition(
    node: cytoscape.NodeSingular
  ): cytoscape.Position | undefined {
    const lngLat = this.getNodeLngLat(node) || (node.scratch('leaflet') && node.scratch('leaflet').currentGeoposition);
    if (!lngLat) {
      return;
    }

    return this.map?.latLngToContainerPoint(lngLat);
  }
}
