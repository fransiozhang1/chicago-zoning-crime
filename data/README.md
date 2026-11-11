# Local research inputs

Place research source files here. Git tracks this inventory; source inputs in this directory remain local.

| Example path | Expected contents |
| --- | --- |
| `ordinance.pdf` | A text-readable Chicago zoning ordinance, with the snapshot year recorded in the research notes. |
| `zoning.geojson` | District polygons for the same analysis year, with official district codes and a valid CRS. |
| `tracts.geojson` | Census tract polygons with a tract identifier and valid CRS. |

The simulator retains the original bundled tract 4207 data and other inputs alongside the source that consumes them, including the district WKT, street network, sample-level spatial indicators and historical incident reference. The workshop deck identifies Mapillary, the Chicago Data Portal and historical lighting data as inputs to the broader research. Raw imagery, citywide training data, embedding indexes, keys and generated results are external to this source tree.
