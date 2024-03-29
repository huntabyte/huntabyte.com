/* Thanks to @joyofcodedev for doing the heavy lifting on this one. */
import { unified } from "unified"
import fromMarkdown from "remark-parse"
import fromMarkdownToHtml from "remark-rehype"
import parseHtmlAndMarkdown from "rehype-raw"
import toHtml from "rehype-stringify"
import matter from "gray-matter"
import readingTime from "reading-time"
import remarkTwoslashImport from "remark-shiki-twoslash"

// plugins
import remarkGfm from "remark-gfm"
import remarkSlug from "remark-slug"
import remarkHeadings from "remark-autolink-headings"
import remarkSmartyPants from "remark-smartypants"
import rehypeCodeTitles from "rehype-code-titles"

import { z } from "zod"

import type { PageContent } from "$lib/types"
import { frontMatterSchema, readingTimeSchema } from "$lib/schemas"
import { logger } from "$lib/logger"

const remarkTwoslash: typeof remarkTwoslashImport =
	typeof remarkTwoslashImport === "function"
		? remarkTwoslashImport
		: // rome-ignore lint/suspicious/noExplicitAny: <explanation>
		  (remarkTwoslashImport as any).default

// TODO: Add link to source - need to think about S3, CF, or Cloudinary for this.
function searchAndReplace(content: string): string {
	const embeds = /{% embed src="(.*?)" title="(.*?)" %}/g
	const videos = /{% video src="(.*?)" %}/g
	const images = /{% img src="(.*?)" alt="(.*?)" %}/g

	return content
		.replace(embeds, (_, src, title) => {
			return `
        <iframe
          title="${title}"
          src=""
          loading="lazy"
        ></iframe>
      `.trim()
		})
		.replace(videos, (_, src) => {
			return `
        <video controls>
          <source
            src="${src}"
            type="video/mp4"
          />
        </video>
      `.trim()
		})
		.replace(images, (_, src, alt) => {
			return `
      <img
        src="${src}"
        alt="${alt}"
        loading="lazy"
      />
  `.trim()
		})
}

export async function compileMarkdown(
	markdown: string,
	slug: string,
): Promise<PageContent> {
	logger.debug(`Compiling markdown for "${slug}"`)
	const { content, data } = matter(markdown)

	// manually set the slug to maintain sync with the file name
	data.slug = slug

	const result = await unified()
		.use(fromMarkdown)
		.use([
			[
				remarkTwoslash,
				{
					theme: "github-dark",
					langs: ["typescript", "svelte", "prisma", "html", "css", "bash"],
				},
			],
			remarkGfm,
			remarkHeadings,
			remarkSlug,
			remarkSmartyPants,
		])
		.use(fromMarkdownToHtml, { allowDangerousHtml: true })
		.use(rehypeCodeTitles)
		.use(parseHtmlAndMarkdown)
		.use(toHtml)
		.process(searchAndReplace(content))

	const compiledContent = z.string().parse(result.value)
	logger.debug(`Compiled markdown for "${slug}"`)
	const readTime = readingTime(compiledContent)

	return {
		content: compiledContent,
		frontMatter: frontMatterSchema.parse(data),
		readTime: readingTimeSchema.parse(readTime),
	}
}
