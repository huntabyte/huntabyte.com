<script lang="ts">
	import ArticleCard from '$lib/components/ArticleCard.svelte'
	import type { PageData } from './$types'

	export let data: PageData
	$: ({ posts } = data)
</script>

<div class="flex flex-col mx-auto items-center space-y-12 max-w-2xl">
	<div class="w-full">
		<div class="mx-auto px-6">
			<div class="text-center">
				<p class="font-semibold text-4xl">Writing</p>
				<p class="mx-auto max-w-md text-lg text-gray-100 pt-2 whitespace-nowrap">
					<em> "You can make anything by writing" </em>
					<br />
					<span class="text-base"> -C.S. Lewis </span>
				</p>
			</div>
		</div>
	</div>
	<div class="flex flex-col space-y-8">
		{#each posts as post}
			<ArticleCard {post} />
		{/each}
	</div>
</div>
