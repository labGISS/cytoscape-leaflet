import L from 'leaflet';
import * as cytoscape from 'cytoscape';

export interface MapHandlerOptions {
  getPosition: (node: cytoscape.NodeSingular) => L.LatLng | null;
  setPosition?: (node: cytoscape.NodeSingular, lngLat: L.LatLng) => void;
  animate?: boolean;
  animationDuration?: number;
  layout?: cytoscape.LayoutOptions;
  hideNonPositional?: boolean;
  lockNodeGeographicalPositionAfterLayout?: boolean; // after first layout lock nodes to the current geographical position on the map
  runLayoutOnViewport?: boolean; // whether run the layout after an viewport update (pan/zoom)
  delayOnMove?: number; // delay (in ms) before layout runs after dragging the map
}

type RegisterFn = (mapConfig: L.MapOptions, config: MapHandlerOptions) => any;

export type Instance = (
  core: string,
  module: string,
  fn: RegisterFn
) => cytoscape.Core;
