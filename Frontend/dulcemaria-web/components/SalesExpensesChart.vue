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
  salesData: {
    type: Array as () => number[],
    required: true
  },
  expensesData: {
    type: Array as () => number[],
    required: true
  }
})

const formatClp = (value: number) => new Intl.NumberFormat('es-CL').format(Math.round(value))

const chartData = computed(() => ({
  labels: props.labels,
  datasets: [
    {
      label: 'Ventas',
      data: props.salesData,
      backgroundColor: '#22c55e',
      borderRadius: 6,
      maxBarThickness: 28
    },
    {
      label: 'Gastos',
      data: props.expensesData,
      backgroundColor: '#f87171',
      borderRadius: 6,
      maxBarThickness: 28
    }
  ]
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false
  },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: '#57534e',
        font: { family: 'Inter, sans-serif' },
        usePointStyle: true
      }
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: $${formatClp(Number(ctx.raw))}`
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
      ticks: {
        color: '#78716c',
        callback: (value: any) => `$${formatClp(Number(value))}`
      }
    }
  }
}))
</script>
