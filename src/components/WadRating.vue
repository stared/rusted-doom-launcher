<script setup lang="ts">
const props = withDefaults(defineProps<{
  rating: number;
  readonly?: boolean;
}>(), {
  readonly: false,
});

const emit = defineEmits<{
  change: [rating: number];
}>();

function select(star: number) {
  if (!props.readonly) emit("change", props.rating === star ? 0 : star);
}
</script>

<template>
  <div class="flex items-center gap-0.5" :aria-label="rating ? `${rating} of 5 stars` : 'Not rated'">
    <button
      v-for="star in 5"
      :key="star"
      type="button"
      class="text-base leading-none transition-colors"
      :class="star <= rating ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-300'"
      :disabled="readonly"
      :aria-label="readonly ? `${rating} of 5 stars` : `Rate ${star} of 5 stars`"
      :aria-pressed="!readonly && star === rating"
      @click.stop="select(star)"
    >★</button>
  </div>
</template>
