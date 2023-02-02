import type {
	blogListItemSchema,
	frontMatterSchema,
	pageContentSchema,
} from "$lib/schemas"
import type { z } from "zod"

export type looseAutocomplete<T extends string> = T | Omit<string, T>

export type FrontMatter = z.infer<typeof frontMatterSchema>

export type PageContent = z.infer<typeof pageContentSchema>

export type BlogListItem = z.infer<typeof blogListItemSchema>

export type ContentDir = "blog" | "til"
