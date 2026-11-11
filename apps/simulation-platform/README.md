# Chicago Crime Simulation Platform

<p align="center">
  <strong>芝加哥街区治安数字孪生平台</strong><br />
  A frontend-only urban safety twin for zoning control, spatial analysis, and multi-agent simulation.
</p>

<p align="center">
  <a href="#readme-zh">中文</a> ·
  <a href="#readme-en">English</a>
</p>

---

<a id="readme-zh"></a>
## 中文说明

### 项目简介

这是一个纯前端的芝加哥街区治安数字孪生平台。项目将分区管控、建筑生成、主体行为仿真、环境指标分析和 GIS 地图可视化整合在同一个网页中运行，不再依赖 Docker、GAMA 后端或 WebSocket 服务。

当前版本重点包含：

- 基于真实 zoning 数据的分区建筑生成
- 基于本地前端逻辑的 agent 仿真
- 实时犯罪风险热力图与治安隐患点可视化
- 9 大环境空间指标加载与显示
- GAMA 模型文件本地引用展示
- 政策 PDF 导入、参数提取、确认应用与撤销

### 核心功能

#### 1. 分区建筑生成

- 使用芝加哥 zoning WKT CSV 数据切分街区地块
- 支持 `R / B / C` 不同分区类型的差异化建筑生成
- 支持调节：
  - FAR
  - 最大高度
  - 最小地块面积
  - 前退距
  - 停车位需求
  - 使用许可与场地设计选项
- 建筑、绿化带、停车区、公园都会在地图上同步更新

#### 2. 主体行为仿真

- 居民与坏人会在道路网络和公园范围内活动
- 主体数量会随模拟时间动态变化
- 夜间坏人比例更高，白天更低
- 主体视野、停留、公园进入、路径选择都在前端本地计算
- 地图左上角显示实时模拟时间

#### 3. 风险可视化

- 实时热力图采用更明显的分级色带
- 治安隐患点会作为独立标记显示在图上
- 历史犯罪点、环境指标点、主体视野范围都可视化显示
- 路灯白天自动熄灭，夜间影响风险计算

#### 4. 政策导入

- 左下角新增政策按钮
- 支持上传政策 PDF
- 自动提取和菜单参数相关的条款
- 用户点击“确认更改”后，会把可映射参数写回 `RT-4` 菜单配置
- 支持“取消政策变化”，恢复应用前的原始参数

### 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 6 |
| 样式 | Tailwind CSS 4 |
| 地图 | Leaflet |
| 叠加绘制 | Canvas 2D |
| 空间分析 | `@turf/turf` |
| 图标 | Lucide React |
| PDF 解析 | `pdfjs-dist` |

### 快速开始

```bash
npm install
npm run dev
```

默认本地地址：

```bash
http://localhost:3000
```

其他命令：

```bash
npm run lint
npm run build
npm run preview
```

### 项目结构

```text
src/
├── App.tsx
├── types.ts
├── components/
│   ├── MapCanvas.tsx
│   ├── ParamPanel.tsx
│   └── PolicyImportModal.tsx
├── constants/
│   ├── coordinates.ts
│   ├── tracts.ts
│   └── zoningConfig.ts
├── data/
│   └── zoning_wkt.csv
├── utils/
│   ├── simulation.ts
│   ├── zoningData.ts
│   ├── zoningBuildingGenerator.ts
│   ├── tract4207Data.ts
│   ├── environmentalIndices.ts
│   ├── pastCrimes.ts
│   ├── dxfScene.ts
│   ├── osmRoads.ts
│   └── zoningPolicy.ts
└── i18n.tsx
```

### 数据来源

- `4207_indices - 9features.csv`
  - 4207 区域样本级 9 特征数据
- `tract_4207_spatial_features.csv`
  - 特征统计与重要性元数据
- `road+block.dxf`
  - 道路与街区几何参考
- `src/data/zoning_wkt.csv`
  - 分区地块数据
- `gama-model/chicago_crime.gaml`
  - 本地引用的 GAMA 模型文件

### 当前实现说明

- 项目现在是纯前端运行
- 不需要后端
- 不需要 Docker
- 不需要 GAMA runtime 服务
- README 中描述以当前仓库实现为准

### License

MIT

---

<a id="readme-en"></a>
## English

### Overview

This repository is a frontend-only urban safety digital twin for Chicago neighborhoods. It combines zoning control, procedural building generation, agent-based simulation, spatial indicators, and GIS visualization in a single web app, without requiring Docker, a GAMA backend, or a WebSocket bridge.

The current version includes:

- zoning-driven building generation
- local frontend agent simulation
- real-time crime-risk heatmap and hazard-point visualization
- 9 spatial environmental indicators
- local GAMA model file reference
- policy PDF import, parameter extraction, apply, and revert

### Core Features

#### 1. Zoning-Based Building Generation

- Uses Chicago zoning WKT CSV data to split tract geometry into buildable pieces
- Supports distinct `R / B / C` zone-family generation logic
- Adjustable controls include:
  - FAR
  - max height
  - minimum lot area
  - front setback
  - parking requirement
  - use permissions and site-design toggles
- Buildings, green strips, parking pads, and parks update together on the map

#### 2. Agent Simulation

- Residents and criminals move within the road network and park areas
- Agent population changes dynamically with simulation time
- Criminal share is higher at night and lower during daytime
- Vision, park visits, lingering, and path choice are all computed in the browser
- A compact live simulation clock is shown at the top-left of the map

#### 3. Risk Visualization

- The real-time heatmap uses a stronger stepped color scale
- Hazard points are rendered as a separate visual layer
- Historical crime points, indicator points, and agent vision ranges are all visualized
- Streetlights switch off during daytime and affect risk at night

#### 4. Policy Import

- A new policy button is available in the bottom-left corner
- Users can upload a policy PDF
- The app extracts only the clauses that map to existing menu parameters
- After confirmation, mapped values are written back into the `RT-4` zoning controls
- Users can revert the policy changes and restore the previous state

### Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | React 19 + TypeScript |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 |
| Map | Leaflet |
| Overlay Rendering | Canvas 2D |
| Spatial Analysis | `@turf/turf` |
| Icons | Lucide React |
| PDF Parsing | `pdfjs-dist` |

### Getting Started

```bash
npm install
npm run dev
```

Default local URL:

```bash
http://localhost:3000
```

Other useful commands:

```bash
npm run lint
npm run build
npm run preview
```

### Project Structure

```text
src/
├── App.tsx
├── types.ts
├── components/
│   ├── MapCanvas.tsx
│   ├── ParamPanel.tsx
│   └── PolicyImportModal.tsx
├── constants/
│   ├── coordinates.ts
│   ├── tracts.ts
│   └── zoningConfig.ts
├── data/
│   └── zoning_wkt.csv
├── utils/
│   ├── simulation.ts
│   ├── zoningData.ts
│   ├── zoningBuildingGenerator.ts
│   ├── tract4207Data.ts
│   ├── environmentalIndices.ts
│   ├── pastCrimes.ts
│   ├── dxfScene.ts
│   ├── osmRoads.ts
│   └── zoningPolicy.ts
└── i18n.tsx
```

### Data Sources

- `4207_indices - 9features.csv`
  - sample-level 9-feature dataset for tract 4207
- `tract_4207_spatial_features.csv`
  - feature statistics and importance metadata
- `road+block.dxf`
  - road and block geometry reference
- `src/data/zoning_wkt.csv`
  - zoning parcel data
- `gama-model/chicago_crime.gaml`
  - locally referenced GAMA model file

### Current Implementation Notes

- The app now runs entirely on the frontend
- No backend is required
- No Docker is required
- No live GAMA runtime service is required
- This README reflects the current repository state

### License

MIT
