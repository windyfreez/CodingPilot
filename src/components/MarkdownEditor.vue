<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { View, Edit } from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'save'): void
}>()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

const mode = ref<'edit' | 'preview'>('edit')
const inner = ref(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    if (v !== inner.value) inner.value = v
  }
)

watch(inner, (v) => {
  emit('update:modelValue', v)
})

const html = computed(() => md.render(inner.value))

const stats = computed(() => {
  const lines = inner.value.split('\n').filter((l) => l.trim() !== '')
  const todoCount = lines.filter((l) => /^\s*[-*]\s*\[ \]/.test(l)).length
  const doneCount = lines.filter((l) => /^\s*[-*]\s*\[x\]/i.test(l)).length
  return { lines: lines.length, todo: todoCount, done: doneCount }
})

function onKeydown(e: KeyboardEvent) {
  // Ctrl/Cmd + S 保存
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    emit('save')
  }
}
</script>

<template>
  <div class="md-editor">
    <div class="md-toolbar">
      <el-radio-group v-model="mode" size="small">
        <el-radio-button value="edit">
          <el-icon class="mr-1"><Edit /></el-icon>编辑
        </el-radio-button>
        <el-radio-button value="preview">
          <el-icon class="mr-1"><View /></el-icon>预览
        </el-radio-button>
      </el-radio-group>
      <span class="md-stats">
        {{ stats.lines }} 行
        <template v-if="stats.todo > 0">
          · TODO <span class="text-amber-500">{{ stats.todo }}</span>
          <template v-if="stats.done > 0"> / 已完成 <span class="text-green-500">{{ stats.done }}</span></template>
        </template>
      </span>
      <el-button type="primary" size="small" @click="emit('save')">保存 (Ctrl+S)</el-button>
    </div>
    <textarea
      v-if="mode === 'edit'"
      v-model="inner"
      class="md-textarea"
      :placeholder="placeholder ?? '记录项目架构、核心逻辑、TODO 列表…（支持 Markdown 语法）'"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <div v-else class="md-body md-preview">
      <div v-if="!html" class="text-slate-500 text-sm">暂无内容</div>
      <div v-else v-html="html" />
    </div>
  </div>
</template>

<style scoped>
.md-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid rgba(0, 212, 255, 0.14);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(10, 17, 32, 0.6);
}
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(0, 212, 255, 0.12);
  background: rgba(0, 212, 255, 0.04);
}
.md-stats {
  flex: 1;
  font-size: 12px;
  color: #5a6b8c;
  font-family: Consolas, monospace;
}
.md-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 14px;
  font-size: 14px;
  line-height: 1.7;
  font-family: Consolas, Monaco, 'Courier New', 'PingFang SC', monospace;
  background: transparent;
  color: #c9d8ee;
  caret-color: #00d4ff;
}
.md-textarea::placeholder {
  color: #3a4a6a;
}
.md-preview {
  flex: 1;
  overflow-y: auto;
  padding: 14px 18px;
}
</style>
