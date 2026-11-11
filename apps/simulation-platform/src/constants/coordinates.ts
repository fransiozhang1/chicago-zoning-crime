import { Coordinate, Vector2D } from '../types';

// The raw WKT multipolygon provided by the user
export const RAW_MULTIPOLYGON = `MULTIPOLYGON (((-87.64386399998179 41.663210000020875, -87.64362100000146 41.663212999982306, -87.64325800002099 41.663218999999415, -87.64289299997748 41.66322300001701, -87.64265100002356 41.66322600002392, -87.64240499996882 41.6632300000079, -87.64204800003326 41.66323699999658, -87.64166800002006 41.66324200000621, -87.6414229999648 41.663245999995084, -87.64143800000849 41.66360900000623, -87.64145300001212 41.66396900001119, -87.64147600001778 41.66470100000017, -87.6414879999713 41.665065999978516, -87.64149800000833 41.665430999969765, -87.64153000004426 41.66652700000956, -87.64153200000743 41.666575999970206, -87.64154699998666 41.66689300002085, -87.64156200001318 41.66725699996668, -87.64156600001174 41.66732799998742, -87.64159100002365 41.66834900002896, -87.64159299998863 41.66841799999547, -87.64160499995823 41.66871400000467, -87.6416179999992 41.66907800000564, -87.64163999995544 41.66963099997779, -87.64165700001278 41.67017299997934, -87.64166999998075 41.670539000029116, -87.64142800002466 41.67054099998138, -87.64106899997033 41.670544000028364, -87.64070500001249 41.670548000009134, -87.64046499997984 41.67055100000734, -87.64022399999344 41.67055300002192, -87.63986400000339 41.67055800002479, -87.63950200002644 41.67056099999076, -87.63926200002449 41.670562999976696, -87.63905499999423 41.67056400001418, -87.63865999996071 41.67056799999895, -87.63843499999761 41.670570999973194, -87.6382289999665 41.67057399998033, -87.63817099997348 41.67057399997931, -87.63814399996897 41.67057499999416, -87.63799800002025 41.67057600002713, -87.63794100001488 41.670577000029354, -87.63790199997258 41.67057699999893, -87.63778899996886 41.67057799999297, -87.63775100000385 41.67057899996436, -87.63757199999705 41.67057999999927, -87.63745699998411 41.67058099997757, -87.63703800003695 41.67058500001125, -87.63686100002475 41.67058699997902, -87.6366199999973 41.6705889999818, -87.63525699996203 41.670593000030145, -87.63589900002061 41.67059600000811, -87.6356589999815 41.67059899998541, -87.63541799997063 41.67060100000591, -87.63505200002298 41.67060600002396, -87.63469799996595 41.670608999979386, -87.63445800001269 41.67061199998734, -87.63421599996902 41.67061399998202, -87.6338519999864 41.67061800000359, -87.63349300001038 41.670622000022306, -87.63325299996062 41.67062499998283, -87.63301300002196 41.670627000021994, -87.63265699995459 41.67063000002739, -87.63229500003685 41.670632999999455, -87.6320560000354 41.6706359999922, -87.63181499997991 41.67063800000297, -87.6314530000377 41.670643000005896, -87.63109300000396 41.67064599996563, -87.6308530000419 41.67064899999112, -87.6306119999867 41.67064999997922, -87.63025399997514 41.67065300000254, -87.62989000002125 41.670657000029344, -87.62964999997023 41.670660000011644, -87.62963599996037 41.670296999984174, -87.62959499999582 41.6692079999803, -87.62958700001458 41.66897500001765, -87.62958399999985 41.668846000014675, -87.62956800003172 41.66848499997888, -87.62956500004061 41.668398999975565, -87.62956100003146 41.66831800000917, -87.62957000003051 41.6682840000188, -87.62953499996534 41.667403000024805, -87.62952200003056 41.66704200001493, -87.62950699997168 41.66667999997526, -87.62946499998155 41.66559599998118, -87.6294509999661 41.66523499997113, -87.62943500004376 41.66485800002983, -87.62939000002281 41.663728000004, -87.6293749999962 41.66335200001514, -87.62961399996941 41.66334699998286, -87.62998200000979 41.66334000000772, -87.63033300001908 41.66333400002248, -87.63057300000152 41.663331000005826, -87.63081200001211 41.663326999991384, -87.63153200003994 41.66331499998395, -87.63177199999454 41.663312000001476, -87.63175099999162 41.66233800000949, -87.63169100004554 41.65941800000562, -87.63167099995711 41.65844500000646, -87.6315919999956 41.65833999997675, -87.63135500001712 41.65802600000431, -87.63127600000024 41.65792199999736, -87.63121399995941 41.65783699999158, -87.63118600004078 41.657797999988944, -87.63109699997128 41.657673000007634, -87.63103299998151 41.65758400000725, -87.63102999999337 41.65757999997048, -87.63096900000475 41.657496000010696, -87.63109300000458 41.65748299999426, -87.63128399998692 41.65746499999458, -87.63146600003425 41.657489000002585, -87.63152600003161 41.65749800002746, -87.63159099999338 41.65750399996431, -87.63229900002239 41.65748999996925, -87.63422999999132 41.65744800001855, -87.63513100003351 41.65743400000128, -87.63543699996788 41.657434000019, -87.63635599999394 41.657434000014, -87.63666299996311 41.65743400001853, -87.63757500002403 41.657433999979396, -87.63869199998155 41.657434000026704, -87.64031099996453 41.6574340000032, -87.64072200003719 41.657434000015115, -87.64097299999348 41.65743399998286, -87.64122400004207 41.65743400002045, -87.64234800002043 41.65735300002172, -87.64572200000846 41.657114000019774, -87.64684699998719 41.65703400002963, -87.64683799995655 41.657113000003974, -87.64682899995611 41.65718499996484, -87.64682899999411 41.657191999976945, -87.6467960000298 41.65749199996358, -87.64677899998215 41.65763899999388, -87.64676300002273 41.657791000020936, -87.64678099995415 41.65789700003155, -87.64683499998989 41.65821600000904, -87.64685399999757 41.65832299997724, -87.64683300000006 41.65878899998118, -87.64683199999372 41.65880700002243, -87.64678000003812 41.659934999964804, -87.64676600000162 41.66022899998019, -87.64676400001554 41.66026200000004, -87.64674200002682 41.66074699997336, -87.6467600000278 41.66123000001016, -87.64676099995563 41.66125600003038, -87.64681300003795 41.66268100000975, -87.64683099998882 41.66316499998456, -87.64672299999943 41.66316600002362, -87.64640100002914 41.66317099997006, -87.64629400002995 41.66317299999651, -87.64605200001394 41.6631770000013, -87.6456929999825 41.663183000000366, -87.64532599998296 41.663185999994376, -87.64508500001452 41.66318899999848, -87.64483999998482 41.66319300000032, -87.64447600001374 41.66320100001274, -87.64410800001575 41.66320600001406, -87.64386399998179 41.663210000020875)))`;

// Parse the raw multipolygon string into coordinates
export function parseMultipolygon(wkt: string): Coordinate[] {
  try {
    const coordsSection = wkt.split('(((')[1]?.split(')))')[0];
    if (!coordsSection) return [];
    
    return coordsSection.split(',').map(pair => {
      const parts = pair.trim().split(/\s+/);
      return {
        lng: parseFloat(parts[0]),
        lat: parseFloat(parts[1])
      };
    }).filter(c => !isNaN(c.lng) && !isNaN(c.lat));
  } catch (e) {
    console.error("Failed to parse polygon coordinate data", e);
    return [];
  }
}

export const OUTLINE_COORDINATES = parseMultipolygon(RAW_MULTIPOLYGON);

// Find geographic bounding box of the block
export function getBoundingBox(coords: Coordinate[]) {
  if (coords.length === 0) {
    return { minLng: -87.6468, maxLng: -87.6293, minLat: 41.6570, maxLat: 41.6706 };
  }
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  coords.forEach(c => {
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
  });

  return { minLng, maxLng, minLat, maxLat };
}

export const BOUNDING_BOX = getBoundingBox(OUTLINE_COORDINATES);

/**
 * Projects a GPS coordinate into normalized local 2D space (0 to 1000)
 * maintaining correct aspect ratio.
 */
export function projectCoordinate(
  coord: Coordinate,
  width: number,
  height: number,
  padding: number = 40,
  bbox = BOUNDING_BOX
): Vector2D {
  const { minLng, maxLng, minLat, maxLat } = bbox;
  
  const mapWidth = width - padding * 2;
  const mapHeight = height - padding * 2;
  
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  
  // Calculate aspect ratio of GPS coords
  // Latitude shrinks degrees longitude by cos(lat)
  const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(avgLatRad);
  
  const geoAspectRatio = (lngSpan * cosLat) / latSpan;
  const canvasAspectRatio = mapWidth / mapHeight;
  
  let scaleX = mapWidth / lngSpan;
  let scaleY = mapHeight / latSpan;
  
  // Adjust scales to preserve aspect ratio
  if (canvasAspectRatio > geoAspectRatio) {
    // Canvas is wider than GPS shape, fit to height
    scaleX = scaleY * cosLat;
  } else {
    // Canvas is taller than GPS shape, fit to width
    scaleY = scaleX / cosLat;
  }
  
  // Center alignment offset
  const actualWidth = lngSpan * scaleX;
  const actualHeight = latSpan * scaleY;
  const offsetX = padding + (mapWidth - actualWidth) / 2;
  const offsetY = padding + (mapHeight - actualHeight) / 2;
  
  // Convert: X is longitude (east-west), Y is latitude (north-south, inverted on canvas)
  const x = offsetX + (coord.lng - minLng) * scaleX;
  const y = offsetY + (maxLat - coord.lat) * scaleY; // Invert Y for screen space
  
  return { x, y };
}

/**
 * Reverses projectCoordinate to get GPS coordinates from canvas coordinate
 */
export function unprojectCoordinate(
  pos: Vector2D,
  width: number,
  height: number,
  padding: number = 40,
  bbox = BOUNDING_BOX
): Coordinate {
  const { minLng, maxLng, minLat, maxLat } = bbox;
  
  const mapWidth = width - padding * 2;
  const mapHeight = height - padding * 2;
  
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  
  const avgLatRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const cosLat = Math.cos(avgLatRad);
  
  const geoAspectRatio = (lngSpan * cosLat) / latSpan;
  const canvasAspectRatio = mapWidth / mapHeight;
  
  let scaleX = mapWidth / lngSpan;
  let scaleY = mapHeight / latSpan;
  
  if (canvasAspectRatio > geoAspectRatio) {
    scaleX = scaleY * cosLat;
  } else {
    scaleY = scaleX / cosLat;
  }
  
  const actualWidth = lngSpan * scaleX;
  const actualHeight = latSpan * scaleY;
  const offsetX = padding + (mapWidth - actualWidth) / 2;
  const offsetY = padding + (mapHeight - actualHeight) / 2;
  
  const lng = minLng + (pos.x - offsetX) / scaleX;
  const lat = maxLat - (pos.y - offsetY) / scaleY;
  
  return { lng, lat };
}

/**
 * Generates an internal grid of streets inside the bounding polygon.
 * We'll define key north-south and east-west roads that map nicely inside our boundary coordinates.
 */
export interface StreetNode {
  id: string;
  position: Vector2D;
  isIntersection: boolean;
}

export interface StreetEdge {
  id: string;
  from: string;
  to: string;
  distance: number;
}

export interface StreetGrid {
  nodes: StreetNode[];
  edges: StreetEdge[];
}

export function generateStreetGrid(
  width: number,
  height: number,
  padding: number = 40,
  outlineCoords: Coordinate[] = OUTLINE_COORDINATES,
  bbox = BOUNDING_BOX
): StreetGrid {
  const projectedOutline = outlineCoords.map(c => projectCoordinate(c, width, height, padding, bbox));

  
  // Find bbox in projected canvas coordinates
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  projectedOutline.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  const nodes: StreetNode[] = [];
  const edges: StreetEdge[] = [];
  
  // Generate a grid of streets (4 vertical, 4 horizontal streets inside the bounding box)
  const cols = 4;
  const rows = 4;
  const xCoords: number[] = [];
  const yCoords: number[] = [];
  
  for (let i = 0; i < cols; i++) {
    xCoords.push(minX + (maxX - minX) * (0.15 + 0.7 * (i / (cols - 1))));
  }
  for (let j = 0; j < rows; j++) {
    yCoords.push(minY + (maxY - minY) * (0.15 + 0.7 * (j / (rows - 1))));
  }
  
  // Create nodes at intersections that lie INSIDE or very close to our block outline
  const nodeMap = new Map<string, string>(); // 'col,row' -> nodeId
  
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pos = { x: xCoords[c], y: yCoords[r] };
      // Check if point is inside the projected outline (with a small buffer)
      if (isPointInPolygon(pos, projectedOutline)) {
        const id = `n_${r}_${c}`;
        nodes.push({
          id,
          position: pos,
          isIntersection: true
        });
        nodeMap.set(`${r},${c}`, id);
      }
    }
  }
  
  // Connect adjacent nodes in grid with edges to form streets
  let edgeIdCounter = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const currentId = nodeMap.get(`${r},${c}`);
      if (!currentId) continue;
      
      const currentNode = nodes.find(n => n.id === currentId)!;
      
      // Try to connect to right neighbor
      const rightId = nodeMap.get(`${r},${c + 1}`);
      if (rightId) {
        const rightNode = nodes.find(n => n.id === rightId)!;
        const dist = Math.hypot(currentNode.position.x - rightNode.position.x, currentNode.position.y - rightNode.position.y);
        edges.push({
          id: `e_${edgeIdCounter++}`,
          from: currentId,
          to: rightId,
          distance: dist
        });
      }
      
      // Try to connect to bottom neighbor
      const bottomId = nodeMap.get(`${r + 1},${c}`);
      if (bottomId) {
        const bottomNode = nodes.find(n => n.id === bottomId)!;
        const dist = Math.hypot(currentNode.position.x - bottomNode.position.x, currentNode.position.y - bottomNode.position.y);
        edges.push({
          id: `e_${edgeIdCounter++}`,
          from: currentId,
          to: bottomId,
          distance: dist
        });
      }
    }
  }

  return { nodes, edges };
}

// Ray-casting algorithm to detect if a point lies inside a polygon
export function isPointInPolygon(point: Vector2D, polygon: Vector2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y))
        && (point.x < (xj - xi) * (point.y - yi) / (yj - yi + 1e-10) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
