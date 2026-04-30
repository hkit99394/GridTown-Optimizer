Provided a 2D array of integers filled with 0 and 1s, when 1 means the cell is allowed, 0 means the cell is not allowed.

Provided 2 types of buildings:
1. Service Building: A service building is a building that provides a service to the city. 
It can be placed on any allowed cell.
It will increase the Population of the residential buildings in the surrounding cells.
It takes up a rectangular footprint. Supported examples include 2x2, 2x3, 2x4, 3x3, and more generally nxm when the footprint fits on allowed cells.
Each service building has its own effective area setting. The effect zone extends outward from the service footprint by that service building's own range value.
For example, a service at (5, 6) can boost a residential cell at (1, 5) if it falls inside that service building's configured effect range.
Each service building has its own setting of population increase (e.g. 108, 204, 189, etc.).
Each service building also has its own footprint size and its own effective range.

2. Residential Building: A residential building is a building that provides housing for the city.
It can be placed on any allowed cell.
It will increase the Population of the city.
It takes up a rectangular footprint.
Supported examples include 2x2, 2x3, 3x3, 3x4, and more generally nxm when the footprint fits on allowed cells.
Each residential size or residential type has its own min and max population, e.g. 2×2 min 260 max 780, 2×3 min 480 max 1440.


All buildings are placed on the allowed cells and must connect to roads.
Any building whose footprint covers row index 0 or column index 0 is treated as connected to the road anchor automatically.
Each road component must connect to the road-anchor boundary: at least one road cell in the component lies in row 0 or column 0.

The goal is to maximize the Population of the city, provided the buildings and the roads.
