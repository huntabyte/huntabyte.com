import {
	fetchMarkdownContentList,
	fetchMarkdownContent,
} from "$lib/server/github"
import { cache, cacheDb } from "$lib/server/cache"
import { compileMarkdown } from "$lib/server/markdown"
import { cachified } from "cachified"
import { typedBoolean } from "$lib/utils"
import type {
	PageContent,
	BlogListItem,
	ContentDir,
	ModifiedContent,
} from "$lib/types"
import { blogListItemSchema, pageContentSchema } from "$lib/schemas"
import { logger } from "$lib/logger"
import { RequestError } from "@octokit/request-error"
import { error } from "@sveltejs/kit"

type CachifiedOptions = {
	ttl?: number
	forceFresh?: boolean
	staleWhileRevalidate?: number
}

// default cache options are used when we want to get the value from the cache if it exists
const defaultCacheOptions: CachifiedOptions = {
	ttl: 1000 * 60 * 60 * 24 * 14,
	staleWhileRevalidate: 1000 * 60 * 60 * 24 * 30,
	forceFresh: false,
}

// refresh options are used when we want to force a fresh value from the cache
export const refreshOptions: CachifiedOptions = {
	...defaultCacheOptions,
	forceFresh: true,
}

/**
 * Given a content directory and a slug, gets the raw markdown content from the cache..
 *
 * @param contentDir the content directory where the page content is located
 * Example: "blog" or "snippets"
 * @param slug the slug of the page to get compiled content for
 * Example: "my-first-blog-post"
 * @param options (optional) - Cachified options. If not provided, default options are used.
 *
 */
async function cacheRawPageContent(
	contentDir: string,
	slug: string,
	options: CachifiedOptions = defaultCacheOptions,
): Promise<string> {
	const key = `${contentDir}:${slug}:raw`
	const { ttl, staleWhileRevalidate, forceFresh } = options
	const rawPageContent = await cachified({
		key,
		cache,
		ttl,
		staleWhileRevalidate,
		forceFresh,
		checkValue: (value) => value !== null,
		getFreshValue: async () => fetchMarkdownContent(`${contentDir}/${slug}`),
	})
	if (!rawPageContent) {
		void cache.delete(key)
	}
	return rawPageContent
}

/**
 * Given a content directory and a slug, gets the compiled page content and metadata for that
 * markdown content from the cache.
 *
 * @param contentDir the content directory where the page content is located
 * Example: "blog" or "snippets"
 * @param slug the slug of the page to get compiled content for
 * Example: "my-first-blog-post"
 * @param options (optional) - Cachified options. If not provided, default options are used.
 *
 */
export async function cacheCompiledPageContent(
	contentDir: string,
	slug: string,
	options: CachifiedOptions = defaultCacheOptions,
): Promise<PageContent> {
	const key = `${contentDir}:${slug}:compiled`
	const { ttl, staleWhileRevalidate, forceFresh } = options
	const pageContent = await cachified({
		key,
		cache,
		ttl,
		staleWhileRevalidate,
		forceFresh,
		checkValue: (value) => value !== null,
		getFreshValue: async () => {
			const rawPageContent = await cacheRawPageContent(
				contentDir,
				slug,
				options,
			)

			const compiledPageContent = await compileMarkdown(
				rawPageContent,
				slug,
			).catch((err) => {
				logger.error(
					`Failed to get compiled page content for ${contentDir}/${slug}`,
					err,
				)
				return Promise.reject(err)
			})
			// add slug to frontmatter for linking, etc.
			compiledPageContent.frontMatter.slug = slug

			return compiledPageContent
		},
	})
	if (!pageContent) {
		// if page doesn't exist, remove from cache
		logger.info(`No page content found for ${key}, removing from cache.`)
		void cache.delete(key)
	}

	pageContent.frontMatter.slug = slug

	return pageContentSchema.parse(pageContent)
}

/**
 * Given a content directory get a list of all the content for that directory.
 *
 * @param contentDir the content directory to list files for
 * Example: "blog" or "snippets"
 */
async function cacheContentList(
	contentDir: ContentDir,
	options: CachifiedOptions = defaultCacheOptions,
): Promise<
	{
		name: string
		slug: string
	}[]
> {
	const { ttl, forceFresh, staleWhileRevalidate } = options
	const key = `${contentDir}:list:raw`
	return cachified({
		key,
		cache,
		ttl,
		forceFresh,
		staleWhileRevalidate,
		checkValue: (value: unknown) => Array.isArray(value),
		getFreshValue: async () => {
			const fullContentDirPath = `content/${contentDir}`
			const rawContentList = (
				await fetchMarkdownContentList(fullContentDirPath)
			).map(({ name, path }) => ({
				name,
				slug: path.replace(`${fullContentDirPath}/`, "").replace(/\.md$/, ""),
			}))
			return rawContentList
		},
	})
}

/**
 * @param contentDir the content directory to list files for
 * Example: "blog" or "snippets"
 * @param options (optional) - Cachified options. If not provided, default options
 * are used.
 *
 * Given a content directory, gets the compiled page content and metadata for all
 * markdown content within that directory.
 */
async function cacheCompiledContentList(
	contentDir: ContentDir,
	options: CachifiedOptions = defaultCacheOptions,
): Promise<PageContent[]> {
	const contentList = await cacheContentList(contentDir, options)

	const rawContentList = await Promise.all(
		contentList.map(async ({ slug }) => {
			return {
				markdown: await cacheRawPageContent(contentDir, slug, options),
				slug,
			}
		}),
	)

	const compiledContentList = await Promise.all(
		rawContentList.map((pageContent) =>
			cacheCompiledPageContent(contentDir, pageContent.slug, options),
		),
	)
	return compiledContentList.filter(typedBoolean)
}

/**
 * @param options (optional) - Cachified options. If not provided, default options
 * are used.
 *
 * Returns a list of cached blog items without the page content.
 */
export async function cacheBlogListItems(
	options: CachifiedOptions = defaultCacheOptions,
): Promise<BlogListItem[]> {
	const { ttl, staleWhileRevalidate, forceFresh } = options
	const key = "blog:list:compiled"
	return cachified({
		key,
		cache,
		ttl,
		staleWhileRevalidate,
		forceFresh,
		getFreshValue: async () => {
			let postList = await cacheCompiledContentList("blog", options).then(
				(posts) =>
					posts.filter(
						(post) => !(post.frontMatter.draft || post.frontMatter.unpublished),
					),
			)

			postList = postList.sort((first, last) => {
				const aDate = first.frontMatter.date
				const zDate = last.frontMatter.date

				return zDate.getTime() - aDate.getTime()
			})

			return postList.map((post) => blogListItemSchema.parse(post))
		},
	})
}

/**
 * @param renamed - Array of file paths that were renamed. This only
 * includes the new filename.
 * @param renamedTo - Array of renamed file paths and their previous names separated
 * by a comma.
 *
 * Determines the previous paths of renamed files and removes them from the cache.
 */
function deleteRenamedContentFromCache(
	renamed: string[],
	renamedTo: string[],
): void {
	logger.info("Deleting old entries for renamed content")
	for (const path of renamed) {
		for (const item of renamedTo) {
			if (!item.includes(path)) {
				continue
			}
			const [contentDir, slug] = item.split(",")[0].split("/")
			const keys = [
				`${contentDir}:${slug}:raw`,
				`${contentDir}:${slug}:compiled`,
			]
			keys.forEach((key) => {
				cache.delete(key)
				const result = cacheDb
					.prepare("SELECT value FROM cache WHERE key = ?")
					.get(key)
				if (result) {
					logger.error(`Failed to delete ${key} from cache.`)
				} else {
					logger.info(`Successfully deleted ${key} from cache.`)
				}
			})
		}
	}
}
/**
 * @param removed - Array of filepaths that were removed.
 *
 * Deletes removed content from the cache.
 */
async function deleteRemovedContentFromCache(removed: string[]) {
	for (const path of removed) {
		const [contentDir, slug] = path.split("/")
		const keys = [`${contentDir}:${slug}:raw`, `${contentDir}:${slug}:compiled`]
		keys.forEach((key) => {
			cache.delete(key)
			const result = cacheDb
				.prepare("SELECT value FROM cache WHERE key = ?")
				.get(key)
			if (result) {
				logger.error(`Failed to delete ${key} from cache.`)
			} else {
				logger.info(`Successfully deleted ${key} from cache.`)
			}
		})
	}
}

/**
 * @param modifiedContent - an object of modified content.
 *
 * Syncs the cache db with the modified content on GitHub.
 */
export async function refreshChangedContent(modifiedContent: ModifiedContent) {
	logger.info("Refreshing changed content")
	void deleteRenamedContentFromCache(
		modifiedContent.renamed,
		modifiedContent.renamedTo,
	)
	void deleteRemovedContentFromCache(modifiedContent.deleted)

	const modifiedAndUpdated = [
		...modifiedContent.renamed,
		...modifiedContent.updated,
	].filter((val) => val !== "")

	await Promise.allSettled(
		modifiedAndUpdated.map((fullPath: string) => {
			const splitPath = fullPath.split("/")
			const contentDir = splitPath[0]
			const slug = splitPath[1]
			return cacheCompiledPageContent(contentDir, slug, refreshOptions)
		}),
	).then((results) =>
		results.forEach((result) => {
			if (result.status !== "fulfilled") {
				logger.error("Error refreshing a modified cache entry")
			}
		}),
	)

	await refreshAllCachedContent()

	logger.info("Finished refreshing changed content")

	return true
}

/**
 * Refresh cache for all content on the site. This can be used when the app is first
 * deployed to have the cache populated prior to a user accessing it.
 *
 * It can also be used by a site admin to refresh the cache if they have made
 * changes to the content on GitHub.
 */
export async function refreshAllCachedContent() {
	// Will need to add other content dir types here as well.
	const result = await cacheBlogListItems(refreshOptions)
	if (!result) {
		return false
	}
	return true
}

/**
 * Refresh cache for content given the `contentDir` and `slug`.
 *
 * This can be used by a site admin to refresh the cache if they have made
 * changes to the content on GitHub, but something went wrong with the CI/CD
 * refresh process.
 */
export async function refreshCacheContent(contentDir: string, slug: string) {
	const result = await cacheCompiledPageContent(
		contentDir,
		slug,
		refreshOptions,
	)
	return result
}

// Load function interface with the cache to catch and throw errors that a user can see.
export async function getPageContent(contentDir: string, slug: string) {
	try {
		const result = await cacheCompiledPageContent(contentDir, slug)
		return result
	} catch (e) {
		if (e instanceof RequestError && e.status === 404) {
			logger.warn(`Article ${contentDir}/${slug} not found.`)
			throw error(404, "Article not found.")
		}
		logger.error(
			`An unexpected error occurred while getting page content for ${contentDir}/${slug}.`,
		)
		logger.error(e)
		throw error(500, "An unexpected error occurred. We're looking into it.")
	}
}

// Load function interface with the cache to catch and throw errors that a user can see.
export async function getBlogListItems() {
	try {
		const result = await cacheBlogListItems()
		return result
	} catch (e) {
		logger.error("An unexpected error occurred while getting blog post list.")
		logger.error(e)
		throw error(500, "An unexpected error occurred. We're looking into it.")
	}
}
