/**
 * ECharts 按需注册
 * ---------------------------------------------------------------
 * 只注册统计页实际用到的图表与组件，避免把完整 echarts 打进首屏。
 * 该模块由 `BaseChart.vue` 动态 import（`await import('@/lib/echarts')`），
 * 因此会单独打成一个异步 chunk：没进统计/后台页面的用户不会下载它。
 *
 * 新增图表类型时在这里补 `use([...])`，不要改成 `import * as echarts from 'echarts'`，
 * 否则首屏体积会明显变大。
 */

import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

export default echarts
export type { EChartsType } from 'echarts/core'