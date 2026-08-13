<template>
  <Bar :data="chartData" :options="chartOptions" />
</template>

<script setup lang="ts">
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const props = defineProps({
  labels: {
    type: Array as () => string[],
    required: true
  },
  counts: {
    type: Array as () => number[],
    required: true
  }
})

const palette = ['#f59e0b', '#3b82f6', '#8b5cf6', '#22c55e', '#ec4899']

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      label: 'Cantidad de Ventas',
      data: props.counts,
      backgroundColor: props.labels.map((_, i) => palette[i % palette.length]),
      borderRadius: 6,
      maxBarThickness: 56
    }
  ]
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.raw} ventas`
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: '#78716c' }
    },
    y: {
      beginAtZero: true,
      grid: { color: '#f5f5f4' },
      ticks: { color: '#78716c', precision: 0 }
    }
  }
}))
</script>
