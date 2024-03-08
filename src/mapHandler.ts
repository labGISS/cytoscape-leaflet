import L, { PointTuple } from 'leaflet';
import { MapHandlerOptions } from './types';
import { getUpdatedPositionsMemo, isMultSelKeyDown, assign } from './utils';
import cytoscape from 'cytoscape';
// import { filter } from 'minimatch';

const DEFAULT_FIT_PADDING: PointTuple = [50, 50];
const DEFAULT_ANIMATION_DURATION = 1;
const HIDDEN_CLASS = 'cytoscape-map__hidden';

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
  layouting: boolean = false;

  requestAnimationId: number | undefined;

  onGraphContainerMouseDownBound = this.onGraphContainerMouseDown.bind(this);
  onGraphContainerMouseMoveBound = this.onGraphContainerMouseMove.bind(this);
  onGraphContainerWheelBound = this.onGraphContainerWheel.bind(this);
  onMapMoveBound = this.onMapMove.bind(this);

  onLayoutStartBound = this.onLayoutStart.bind(this);
  onLayoutStopBound = this.onLayoutStop.bind(this);

  onGraphAddBound = this.onGraphAdd.bind(this);
  onGraphResizeBound = this.onGraphResize.bind(this);
  onGraphDragFreeBound = this.onGraphDragFree.bind(this);
  onDataChangeBound = this.onDataChange.bind(this);

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
    graphContainer.addEventListener(
      'mousedown',
      this.onGraphContainerMouseDownBound
    );
    graphContainer.addEventListener(
      'mousemove',
      this.onGraphContainerMouseMoveBound
    );
    graphContainer.addEventListener('wheel', this.onGraphContainerWheelBound);
    this.cy.on('add', this.onGraphAddBound);
    this.cy.on('resize', this.onGraphResizeBound);
    this.cy.on('dragfree', this.onGraphDragFreeBound);
    this.cy.on('data', this.onDataChangeBound);

    this.cy.on("layoutstart ", this.onLayoutStartBound);
    this.cy.on("layoutstop", this.onLayoutStopBound);

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
      graphContainer.removeEventListener(
        'mousedown',
        this.onGraphContainerMouseDownBound
      );
      graphContainer.removeEventListener(
        'mousemove',
        this.onGraphContainerMouseMoveBound
      );
      graphContainer.removeEventListener(
        'wheel',
        this.onGraphContainerWheelBound
      );
    }
    if (this.cy) {
      this.cy.off('add', this.onGraphAddBound);
      this.cy.off('resize', this.onGraphResizeBound);
      this.cy.off('dragfree', this.onGraphDragFreeBound);
      this.cy.off('data', this.onDataChangeBound);

      this.cy.off('layoutstart', this.onLayoutStartBound);
      this.cy.off('layoutstop', this.onLayoutStopBound);

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
   * @return {cytoscape.LayoutOptions}
   * @param {*} [customOptions]
   */
  private getDefaultLayout(customOptions: any = undefined): cytoscape.LayoutOptions {
    return assign(DEFAULT_LAYOUT, this.options?.layout, customOptions);
  }

  /**
   * Run layout. By default, all nodes are updated
   * @param nodes run the layout for specific nodes
   * @private
   */
  private runDefaultLayout(
    nodes = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
    this.deleteInternalLayoutPosition(nodes);
    nodes.layout(this.getDefaultLayout()).run();
  }


  /**
   * Save each node current layout position as the current geographical position.
   * Node's position is saved into its scratch, as <i>leaflet</i> namespace and <i>currentGeoposition<i> LatLng object
   * @param {cytoscape.NodeCollection} nodes
   */
  private saveInternalLayoutPositionAsLatLng(
    nodes: cytoscape.NodeCollection = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
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
  private deleteInternalLayoutPosition(
    nodes: cytoscape.NodeCollection = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
    nodes?.forEach((node) => {
      if (node.scratch('leaflet') && node.scratch('leaflet').currentGeoposition) {
        delete node.scratch('leaflet').currentGeoposition;
      }
    });
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

    const positions: cytoscape.NodePositionMap = Object.fromEntries(
      nodes
        .map((node) => {
          return [node.id(), this.getGeographicPosition(node)];
        })
        .filter(([_id, position]) => {
          return !!position;
        })
    );

    const nodesWithoutPosition = nodes.filter((node) => !positions[node.id()]);
    const nodesWithPosition = nodes.filter((node) => !!positions[node.id()]);

    if (this.options?.hideNonPositional) {
      // hide nodes without position
      nodesWithoutPosition.addClass(HIDDEN_CLASS).style('display', 'none');
    }

    nodesWithPosition
      ?.layout({
        name: 'preset',
        positions: positions,
        fit: false,
        animate: this.options?.animate,
        animationDuration:
          this.options?.animationDuration ?? DEFAULT_ANIMATION_DURATION,
        animationEasing: 'ease-out-cubic',
      })
      .run();

    nodesWithoutPosition
      ?.layout(this.getDefaultLayout())
      .run();
  }

  /**
   * @private
   * @param {cytoscape.NodeCollection | undefined} nodes
   */
  private updateGeographicPositions(
    nodes = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
    const updatePositions = (
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
      const nodesWithPosition = nodes.filter(
        (node) => !!positions[node.id()]
      );

      if (this.options?.hideNonPositional) {
        nodesWithoutPosition.addClass(HIDDEN_CLASS).style('display', 'none');
      }

      nodesWithPosition
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
    );
  }

  /**
   * @private
   */
  private disableGeographicPositions() {
    const nodes =
      this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection);

    // console.log("disableGeographicPositions");
    // this.cy
    //   ?.layout({
    //     name: 'preset',
    //     positions: this.originalPositions,
    //     fit: false,
    //     animate: this.options?.animate,
    //     animationDuration:
    //       this.options?.animationDuration ?? DEFAULT_ANIMATION_DURATION,
    //     animationEasing: 'ease-in-cubic',
    //     stop: () => {
    //       // show nodes without position
    //       const nodesWithoutPosition = nodes.filter((node) =>
    //         node.hasClass(HIDDEN_CLASS)
    //       );
    //       nodesWithoutPosition.removeClass(HIDDEN_CLASS).style('display', null);
    //     },
    //   })
    //   .run();

    this.deleteInternalLayoutPosition(nodes);
    this.runDefaultLayout(nodes);
    this.originalPositions = undefined;
  }

  /**
   * @private
   * @param {MouseEvent} event
   */
  private onGraphContainerMouseDown(event: MouseEvent) {
    // @ts-ignore
    const renderer = this.cy?.renderer();
    if (
      event.buttons === 1 &&
      !isMultSelKeyDown(event) &&
      !renderer.hoverData.down
    ) {
      // @ts-ignore,
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
      );
    }
  }

  /**
   * @private
   * @param {MouseEvent} event
   */
  private onGraphContainerMouseMove(event: MouseEvent) {
    // @ts-ignore
    const renderer = this.cy?.renderer();
    if (
      event.buttons === 1 &&
      !isMultSelKeyDown(event) &&
      !renderer.hoverData.down
    ) {
      this.panning = true;

      this.dispatchMapEvent(event);
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
    if (this.layouting) {
      // console.log("layouting");
      // When not-native-geographic nodes are in layouting we don't update their position. This should fix a glitch
      // when you move the map when not-native-geographic nodes are in layouting
      // TODO: fix this. It doesn't work because this.layouting become false too early
      this.updateGeographicPositions(this.filterNodes('native-geographic'));
    } else {
      this.updateGeographicPositions();
    }
  }

  /**
   * @private
   * @param {cytoscape.EventObject} event
   */
  private onLayoutStart(event: cytoscape.EventObject) {
    const targets: cytoscape.NodeCollection = event["target"]["options"]["eles"];

    // we save when non-native-geographic nodes starts layouting
    if (this.filterNodes('not-native-geographic', targets).length > 0) {
      // console.log("onLayoutStart");
      this.layouting = true;
    }
  }

  /**
   * @private
   * @param {cytoscape.EventObject} event
   */
  private onLayoutStop(event: cytoscape.EventObject) {
    const targets: cytoscape.NodeCollection = event["target"]["options"]["eles"];

    // we save when non-native-geographic nodes stops layouting
    if (this.filterNodes('not-native-geographic', targets).length > 0) {
      // console.log("onLayoutStop");
      this.layouting = false;
    }

    this.saveInternalLayoutPositionAsLatLng(targets);
  }


  /**
   * @private
   */
  private onDataChange() {
    this.updateGeographicPositions();
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

    // some methods requires a node collection, let make it
    const nodes = this.cy?.collection().merge(node);

    if (this.options?.setPosition) {
      const { x, y } = node.position();
      const position: PointTuple = [x, y];
      const lngLat = this.map?.containerPointToLatLng(position);
      if (lngLat) this.options.setPosition(node, lngLat);
    } else {
      this.saveInternalLayoutPositionAsLatLng(nodes);
    }

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
   * @param {boolean} onlyNativePosition no scratch position
   * @return {cytoscape.Position | undefined}
   */
  private getGeographicPosition(
    node: cytoscape.NodeSingular,
    onlyNativePosition: boolean = false
  ): cytoscape.Position | undefined {

    const lngLat = onlyNativePosition
      ? this.getNodeLngLat(node)
      : this.getNodeLngLat(node) || (node.scratch('leaflet') && node.scratch('leaflet').currentGeoposition);

    if (!lngLat) {
      return;
    }

    return this.map?.latLngToContainerPoint(lngLat);
  }

  /**
   * Filter a type of nodes out of nodes list.
   *
   * 4 types of nodes:
   * <ul>
   *   <li> <b>native-geographic</b>: nodes with a native geographic position (i.e. <i>this.getNodeLngLat()</i> returns non-null value) </li>
   *   <li> <b>geographic</b>: nodes with a geographic position (either native position or internal - i.e. saved in <i>node.scratch()</i> - position) </li>
   *   <li> <b>not-native-geographic</b>: nodes without a native geographic position (i.e. <i>this.getNodeLngLat()</i> returns null value) </li>
   *   <li> <b>not-geographic</b>: nodes without a geographic position (neither native position nor internal position) </li>
   * </ul>
   * @private
   * @param type
   * @param nodes set of nodes to filter, if not specified all noeds on the graph will be filtered
   */
  private filterNodes(
    type: 'geographic' | 'native-geographic' | 'not-geographic' | 'not-native-geographic',
    nodes: cytoscape.NodeCollection = this.cy?.nodes() ?? ([] as unknown as cytoscape.NodeCollection)
  ) {
    const onlyNative = type == 'native-geographic' || type == 'not-native-geographic';

    const positions: cytoscape.NodePositionMap = Object.fromEntries(
      nodes
        .map((node) => {
          return [node.id(), this.getGeographicPosition(node, onlyNative)];
        })
        .filter(([_id, position]) => {
          return !!position;
        })
    );

    if (type == 'geographic' || type == "native-geographic") {
      return nodes.filter((node) => !!positions[node.id()]);
    } else { // not-geographic || not-native-geographic
      return nodes.filter((node) => !positions[node.id()]);
    }
  }
}
