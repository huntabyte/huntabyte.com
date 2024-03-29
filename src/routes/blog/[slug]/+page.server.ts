import { getPageContent } from "$lib/server/content"
import type { PageServerLoad } from "./$types"

export const load: PageServerLoad = async ({ params }) => {
	const { slug } = params

	return {
		pageContent: getPageContent("blog", slug),
	}
}
