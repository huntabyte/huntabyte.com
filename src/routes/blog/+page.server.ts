import { logger } from "$lib/logger"
import { getBlogListItems } from "$lib/server/content"
import type { PageServerLoad } from "./$types"
import { env } from "$env/dynamic/private"

export const load: PageServerLoad = async () => {
	return {
		posts: getBlogListItems(),
	}
}
