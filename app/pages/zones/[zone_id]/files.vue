<template>
	<UDashboardPanel id="zone-files">
		<template #header>
			<UDashboardNavbar>
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>

				<template #title>
					<span>Files</span>
					<span v-if="zoneName" class="text-muted hidden truncate font-normal sm:inline">
						· {{ zoneName }}
					</span>
				</template>

				<template #right>
					<UTooltip v-if="canUse" text="Refresh files">
						<UButton
							icon="i-lucide-refresh-cw"
							color="neutral"
							variant="ghost"
							aria-label="Refresh files"
							:loading="refreshing"
							@click="refreshAll"
						/>
					</UTooltip>
					<UButton
						v-if="ready && canEdit"
						icon="i-lucide-folder-plus"
						label="New folder"
						aria-label="New folder"
						color="neutral"
						variant="outline"
						:ui="{ label: 'hidden sm:inline' }"
						@click="openNewFolder"
					/>
					<UButton
						v-if="ready && canEdit"
						icon="i-lucide-upload"
						label="Upload"
						aria-label="Upload files"
						:ui="{ label: 'hidden sm:inline' }"
						@click="chooseFiles"
					/>
				</template>
			</UDashboardNavbar>

			<UDashboardToolbar
				v-if="ready"
				:ui="{
					root: 'flex-wrap gap-2 py-2 overflow-visible',
					left: 'min-w-0 flex-1',
					right: 'flex-wrap gap-2'
				}"
			>
				<template #left>
					<UBreadcrumb :items="breadcrumb" :ui="{ list: 'flex-wrap', linkLabel: 'max-w-48 truncate' }" />
				</template>

				<template #right>
					<template v-if="selectedRows.length">
						<p class="text-highlighted text-sm tabular-nums">
							{{ formatNumber(selectedRows.length) }} selected
						</p>
						<UButton color="neutral" variant="ghost" label="Clear selection" @click="clearSelection" />
						<UButton
							color="error"
							variant="soft"
							icon="i-lucide-trash-2"
							:label="`Delete ${formatNumber(selectedRows.length)}`"
							@click="openDelete(selectedRows)"
						/>
					</template>
					<p v-else-if="listing.loaded" class="text-muted text-sm tabular-nums" aria-live="polite">
						{{ countLabel }}
					</p>
				</template>
			</UDashboardToolbar>
		</template>

		<template #body>
			<ZoneAccessNote :access="zoneAccess" area="files" subject="files" />
			<AccountFeatureGate
				:loaded="capabilitiesLoaded"
				:available="canUse"
				feature="R2"
				:reason="accessReason"
				hint="R2 has to be turned on for this account in the Cloudflare dashboard first, and the token needs Workers R2 Storage Edit for the account."
				:checking="zoneLoading"
				@retry="refreshZone"
			>
				<div class="flex min-w-0 flex-col gap-6">
					<p class="text-muted text-sm">
						<template v-if="bucket">
							Files for {{ zoneName }} are kept in the R2 bucket
							<code class="text-highlighted font-mono">{{ bucket }}</code> in {{ accountLabel }}, separate
							from other zones.
						</template>
						<template v-else>
							Each zone’s files are kept in an R2 bucket of their own, named after the zone.
						</template>
					</p>

					<UAlert
						v-if="!bucket && zoneError"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						role="alert"
						title="Couldn’t load this zone"
						:description="zoneError"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading: zoneLoading,
								onClick: refreshZone
							}
						]"
					/>

					<div
						v-else-if="!bucket || bucketState.status === 'idle' || bucketState.status === 'loading'"
						class="flex flex-col gap-3"
						aria-busy="true"
					>
						<span class="sr-only" role="status">Checking the bucket…</span>
						<USkeleton class="h-24 w-full" />
						<USkeleton v-for="line in 4" :key="line" class="h-10 w-full" />
					</div>

					<UAlert
						v-else-if="bucketState.status === 'error'"
						color="error"
						variant="subtle"
						icon="i-lucide-circle-alert"
						role="alert"
						:title="`Couldn’t open the bucket ${bucket}`"
						:description="bucketState.message"
						:actions="[
							{
								label: 'Try again',
								icon: 'i-lucide-refresh-cw',
								color: 'neutral',
								variant: 'outline',
								loading: bucketState.loading,
								onClick: loadBucket
							},
							{
								label: 'R2 set-up guide',
								icon: 'i-lucide-external-link',
								color: 'neutral',
								variant: 'outline',
								to: R2_DOCS_URL,
								target: '_blank'
							}
						]"
					/>

					<div
						v-else-if="bucketState.status === 'missing'"
						class="border-default flex flex-col gap-3 border-y py-4 text-sm"
					>
						<p class="text-default">{{ zoneName }} doesn’t have a bucket yet.</p>
						<p class="text-muted">
							Creating it adds an empty bucket called
							<code class="text-default font-mono">{{ bucket }}</code> to {{ accountLabel }}. It stays
							private until you turn on public access.
						</p>
						<UAlert
							v-if="bucketState.createError"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							role="alert"
							title="Cloudflare didn’t create the bucket"
							:description="bucketState.createError"
						/>
						<div class="flex flex-wrap items-center gap-2">
							<UButton
								v-if="canEdit"
								:label="`Create bucket ${bucket}`"
								icon="i-lucide-plus"
								size="sm"
								:loading="bucketState.creating"
								@click="createBucket"
							/>
							<UButton
								label="Check again"
								icon="i-lucide-refresh-cw"
								size="sm"
								color="neutral"
								variant="ghost"
								:loading="bucketState.loading"
								:disabled="bucketState.creating"
								@click="loadBucket"
							/>
						</div>
					</div>

					<template v-else>
						<section v-if="canEdit" aria-labelledby="files-upload-heading" class="flex flex-col gap-3">
							<h2 id="files-upload-heading" class="sr-only">Upload files</h2>
							<UFileUpload
								ref="uploader"
								v-model="picked"
								multiple
								:preview="false"
								layout="list"
								icon="i-lucide-upload"
								:label="`Drop files here to upload them to ${folderLabel}`"
								:description="`or choose them from your device. Up to ${formatBytes(MAX_UPLOAD_BYTES)} each. A file with the same name is replaced.`"
								class="w-full"
								:ui="{ base: 'min-h-24' }"
							/>

							<div v-if="visibleUploads.length" class="flex flex-col gap-2">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<p class="text-highlighted text-sm font-medium" role="status">
										{{ uploadSummary }}
									</p>
									<UButton
										v-if="visibleUploads.some(isSettled)"
										label="Clear finished"
										size="xs"
										color="neutral"
										variant="ghost"
										@click="clearFinished"
									/>
								</div>
								<ul class="divide-default border-default divide-y border-y" aria-label="Uploads">
									<li
										v-for="item in visibleUploads"
										:key="item.id"
										class="flex flex-col gap-1.5 py-2"
									>
										<div class="flex min-w-0 items-center gap-2">
											<UIcon
												:name="UPLOAD_STATES[item.status].icon"
												:class="['size-4 shrink-0', UPLOAD_STATES[item.status].class]"
											/>
											<div class="flex min-w-0 flex-1 flex-col">
												<span class="text-highlighted truncate text-sm" :title="item.key">
													{{ item.name }}
												</span>
												<span class="text-muted truncate text-xs">
													{{ formatBytes(item.size) }} · {{ item.prefix || bucket }}
												</span>
											</div>
											<span class="text-muted shrink-0 text-xs tabular-nums">
												{{ uploadStatusLabel(item) }}
											</span>
											<UButton
												v-if="item.status === 'failed'"
												label="Retry"
												size="xs"
												color="neutral"
												variant="outline"
												:aria-label="`Retry uploading ${item.name}`"
												@click="retryUpload(item)"
											/>
											<UButton
												v-if="item.status === 'waiting' || item.status === 'uploading'"
												icon="i-lucide-x"
												size="xs"
												color="neutral"
												variant="ghost"
												:aria-label="`Cancel uploading ${item.name}`"
												@click="cancelUpload(item)"
											/>
											<UButton
												v-else-if="isSettled(item)"
												icon="i-lucide-x"
												size="xs"
												color="neutral"
												variant="ghost"
												:aria-label="`Dismiss ${item.name}`"
												@click="dismissUpload(item)"
											/>
										</div>
										<div v-if="item.status === 'uploading'" aria-hidden="true">
											<UProgress :model-value="item.percent" size="xs" />
										</div>
										<p v-if="item.error" class="text-error text-xs">{{ item.error }}</p>
									</li>
								</ul>
							</div>
						</section>

						<section aria-labelledby="files-list-heading" class="flex flex-col gap-3">
							<h2 id="files-list-heading" class="sr-only">Files in {{ folderLabel }}</h2>

							<AccountResourceTable
								:data="rows"
								:columns="columns"
								:loading="listing.loading"
								:loaded="listing.loaded"
								:error="listing.error"
								:error-title="listing.loaded ? 'Couldn’t refresh the files' : 'Couldn’t list the files'"
								caption="Files and folders"
								loading-label="Loading files…"
								:get-row-id="getRowId"
								:ui="{ th: 'py-2', td: 'py-2.5' }"
								@retry="loadListing()"
							>
								<template #empty>
									<UEmpty v-bind="emptyState" variant="naked" />
								</template>

								<template #select-header>
									<UCheckbox
										:model-value="
											allSelected ? true : selectedRows.length ? 'indeterminate' : false
										"
										:disabled="!fileRows.length"
										aria-label="Select all files in this folder"
										@update:model-value="toggleAll"
									/>
								</template>

								<template #select-cell="{ row }">
									<UCheckbox
										v-if="row.original.kind === 'file'"
										:model-value="selected.has(row.original.key)"
										:aria-label="`Select ${row.original.name}`"
										@update:model-value="(value) => toggleSelected(row.original, value)"
									/>
								</template>

								<template #name-cell="{ row }">
									<NuxtLink
										v-if="row.original.kind === 'folder'"
										:to="folderLink(row.original.key)"
										class="text-highlighted focus-visible:outline-primary flex min-w-0 items-center gap-2 rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
									>
										<UIcon name="i-lucide-folder" class="text-muted size-4 shrink-0" />
										<span class="truncate" :title="row.original.key">
											<span class="sr-only">Open folder </span
											>{{ row.original.name || '(no name)' }}
										</span>
									</NuxtLink>

									<div v-else class="flex min-w-0 flex-col gap-0.5">
										<button
											type="button"
											class="text-highlighted focus-visible:outline-primary flex min-w-0 items-center gap-2 rounded-sm text-start font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
											:title="row.original.key"
											@click="downloadFile(row.original)"
										>
											<UIcon
												:name="
													downloading.has(row.original.key)
														? 'i-lucide-loader-circle'
														: 'i-lucide-file'
												"
												:class="[
													'text-muted size-4 shrink-0',
													downloading.has(row.original.key) && 'animate-spin'
												]"
											/>
											<span class="truncate">
												<span class="sr-only">Download </span>{{ row.original.name }}
											</span>
										</button>
										<span class="text-muted truncate ps-6 text-xs md:hidden">
											{{ formatBytes(row.original.size) }}
											<template v-if="row.original.modified">
												· {{ formatDate(row.original.modified, 'datetime') }}
											</template>
										</span>
										<div v-if="row.original.url" class="flex min-w-0 items-center gap-1 ps-6">
											<ULink
												raw
												:to="row.original.url"
												target="_blank"
												class="text-muted focus-visible:outline-primary min-w-0 truncate rounded-sm font-mono text-xs hover:underline focus-visible:outline-2"
												>{{ row.original.url }}</ULink
											>
											<UButton
												icon="i-lucide-copy"
												size="xs"
												color="neutral"
												variant="ghost"
												class="shrink-0"
												:aria-label="`Copy the public link to ${row.original.name}`"
												@click="notify.copy(row.original.url, 'Public link')"
											/>
										</div>
									</div>
								</template>

								<template #size-cell="{ row }">
									<span v-if="row.original.kind === 'file'" class="tabular-nums">
										{{ formatBytes(row.original.size) }}
									</span>
								</template>

								<template #modified-cell="{ row }">
									<time
										v-if="row.original.modified"
										:datetime="row.original.modified"
										:title="formatDate(row.original.modified, 'full')"
										class="tabular-nums"
									>
										{{ formatDate(row.original.modified, 'datetime') }}
									</time>
								</template>

								<template #type-cell="{ row }">
									<span v-if="row.original.type" class="text-muted font-mono text-xs">
										{{ row.original.type }}
									</span>
								</template>

								<template #actions-cell="{ row }">
									<div v-if="row.original.kind === 'file'" class="flex justify-end">
										<UDropdownMenu :items="fileActions(row.original)" :content="{ align: 'end' }">
											<UButton
												icon="i-lucide-ellipsis-vertical"
												color="neutral"
												variant="ghost"
												:aria-label="`Actions for ${row.original.name}`"
											/>
										</UDropdownMenu>
									</div>
								</template>
							</AccountResourceTable>

							<div
								v-if="listing.loaded && listing.cursor"
								class="flex flex-wrap items-center justify-between gap-3"
							>
								<p class="text-muted text-sm">
									Showing the first {{ plural(rows.length, 'item') }} in this folder.
								</p>
								<UButton
									label="Load more"
									color="neutral"
									variant="outline"
									:loading="listing.loadingMore"
									:disabled="listing.loading"
									@click="loadListing({ more: true })"
								/>
							</div>
						</section>

						<FilesPublicAccess
							ref="publicAccess"
							:key="zoneId"
							v-model:base="publicBase"
							:zone-id="zoneId"
							:zone-name="zoneName"
							:bucket="bucket"
							:editable="canEdit"
							:removable="canDelete"
						/>
					</template>
				</div>
			</AccountFeatureGate>

			<UModal
				v-model:open="deleteOpen"
				:title="deleteTitle"
				:description="deleteDescription"
				:dismissible="!deleting"
				:close="{ disabled: deleting }"
			>
				<template #body>
					<div class="flex flex-col gap-3">
						<UAlert
							v-if="deleteSummary"
							role="alert"
							color="error"
							variant="subtle"
							icon="i-lucide-circle-alert"
							:title="deleteSummary.title"
							:description="deleteSummary.description"
						/>
						<ul class="divide-default max-h-80 divide-y overflow-y-auto">
							<li
								v-for="target in deleteTargets"
								:key="target.key"
								class="flex min-w-0 flex-col gap-0.5 py-2"
							>
								<span class="text-highlighted truncate text-sm font-medium" :title="target.key">
									{{ target.name }}
								</span>
								<span class="text-muted truncate font-mono text-xs">{{ target.key }}</span>
								<p v-if="deleteFailures[target.key]" class="text-error text-xs">
									{{ deleteFailures[target.key] }}
								</p>
							</li>
						</ul>
					</div>
				</template>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton
							color="neutral"
							variant="ghost"
							:label="deleteSummary ? 'Close' : 'Cancel'"
							:disabled="deleting"
							@click="deleteOpen = false"
						/>
						<UButton
							color="error"
							icon="i-lucide-trash-2"
							:label="deleteButtonLabel"
							:loading="deleting"
							@click="confirmDelete"
						/>
					</div>
				</template>
			</UModal>

			<UModal
				v-model:open="folderOpen"
				title="New folder"
				:description="`Opens a new folder inside ${folderLabel}. R2 has no empty folders, so it’s kept once you upload a file into it.`"
			>
				<template #body>
					<form :id="folderFormId" novalidate @submit.prevent="createFolder">
						<UFormField label="Folder name" name="files-folder-name" required :error="folderError || false">
							<UInput
								v-model="folderName"
								placeholder="images"
								autocomplete="off"
								spellcheck="false"
								autocapitalize="off"
								class="w-full"
								@update:model-value="folderError = ''"
							/>
						</UFormField>
					</form>
				</template>
				<template #footer>
					<div class="flex w-full justify-end gap-2">
						<UButton label="Cancel" color="neutral" variant="ghost" @click="folderOpen = false" />
						<UButton type="submit" :form="folderFormId" label="Open folder" icon="i-lucide-folder-plus" />
					</div>
				</template>
			</UModal>
		</template>
	</UDashboardPanel>
</template>

<script setup>
// Cloudflare's REST API takes uploads of up to 300 MB:
// https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/
// Uploads pass through server/api/r2_upload.post.js, which holds each file in memory, so both
// stop at 100 MB.
const MAX_UPLOAD_BYTES = 100_000_000
// R2's limit on key length: https://developers.cloudflare.com/r2/platform/limits/
const MAX_KEY_BYTES = 1024
const PAGE_SIZE = 100
const UPLOAD_CONCURRENCY = 2
// Cloudflare doesn't document a limit on keys per delete; S3's equivalent takes 1,000.
const DELETE_BATCH = 100
// Cloudflare's code for a bucket that doesn't exist: https://developers.cloudflare.com/r2/api/error-codes/
const NO_SUCH_BUCKET = 10006
const R2_DOCS_URL = 'https://developers.cloudflare.com/r2/get-started/'
const CONTROL_CHARACTER = /\p{Cc}/u

const UPLOAD_STATES = {
	waiting: { icon: 'i-lucide-clock', class: 'text-muted' },
	uploading: { icon: 'i-lucide-loader-circle', class: 'text-primary animate-spin' },
	saving: { icon: 'i-lucide-loader-circle', class: 'text-primary animate-spin' },
	done: { icon: 'i-lucide-circle-check', class: 'text-success' },
	failed: { icon: 'i-lucide-circle-alert', class: 'text-error' },
	refused: { icon: 'i-lucide-circle-alert', class: 'text-error' }
}

const FROM_SM = { th: 'hidden sm:table-cell', td: 'hidden sm:table-cell' }
const FROM_MD = { th: 'hidden md:table-cell', td: 'hidden md:table-cell' }
const FROM_LG = { th: 'hidden lg:table-cell', td: 'hidden lg:table-cell' }

const allColumns = [
	{ id: 'select', header: '', meta: { class: { th: 'w-10', td: 'w-10' } } },
	{ id: 'name', header: 'Name', meta: { class: { td: 'w-full max-w-0 min-w-40' } } },
	{ id: 'size', header: 'Size', meta: { class: FROM_SM } },
	{ id: 'modified', header: 'Last modified', meta: { class: FROM_MD } },
	{ id: 'type', header: 'Content type', meta: { class: FROM_LG } },
	{
		id: 'actions',
		header: () => h('span', { class: 'sr-only' }, 'Actions'),
		meta: { class: { td: 'w-px text-end' } }
	}
]
// Selecting files is only for deleting them, so it's left out when the person can't delete.
const columns = computed(() => (canDelete.value ? allColumns : allColumns.filter((column) => column.id !== 'select')))

const route = useRoute()
const router = useRouter()
const notify = useNotify()
const { exec } = useCfCommands()

const {
	zoneId,
	zone,
	zoneName,
	loading: zoneLoading,
	error: zoneError,
	capabilitiesLoaded,
	missingCapabilities,
	can,
	load: loadZone,
	refresh: refreshZone,
	access: zoneAccess,
	allowed
} = useZone(() => route.params.zone_id)
// On a zone shared with this account, what its files level allows (own zones allow everything).
const canEdit = computed(() => allowed('files', 'edit'))
const canDelete = computed(() => allowed('files', 'delete'))

const accountName = computed(() => zone.value?.account?.name || '')
const accountLabel = computed(() => (accountName.value ? `the ${accountName.value} account` : 'the zone’s account'))
const canUse = computed(() => can('r2'))
const accessReason = computed(() => missingCapabilities.value.find((item) => item.key === 'r2')?.reason || '')
const bucket = computed(() => bucketNameForZone(zoneName.value))

useSeoMeta({ title: computed(() => (zoneName.value ? `Files · ${zoneName.value}` : 'Files')) })

// Decimal units: 1 MB is 1,000,000 bytes.
const BYTE_UNITS = ['kilobyte', 'megabyte', 'gigabyte', 'terabyte'].map(
	(unit) => new Intl.NumberFormat(LOCALE, { style: 'unit', unit, maximumFractionDigits: 1 })
)
const formatBytes = (bytes) => {
	let value = Number(bytes)
	if (!Number.isFinite(value) || value < 0) return ''
	if (value < 1000) return plural(value, 'byte')
	let unit = -1
	while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
		value /= 1000
		unit += 1
	}
	return BYTE_UNITS[unit].format(value)
}

const keyBytes = (key) => new TextEncoder().encode(key).length

// --- Folder in the URL ----------------------------------------------------------------------

const queryValue = (value) => {
	if (typeof value === 'string') return value
	return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

// ?path= holds the folder's prefix as R2 lists it, such as docs/2026/. One typed without the
// trailing slash still opens the folder.
const currentPrefix = computed(() => {
	const path = queryValue(route.query.path)
	return !path || path.endsWith('/') ? path : `${path}/`
})

const folderLink = (prefix) => {
	const { path: _path, ...query } = route.query
	return { path: route.path, query: prefix ? { ...query, path: prefix } : query }
}

const folderParts = computed(() => currentPrefix.value.split('/').slice(0, -1))
const folderLabel = computed(() => currentPrefix.value || bucket.value)

const breadcrumb = computed(() => {
	const parts = folderParts.value
	return [
		{ label: bucket.value, icon: 'i-lucide-hard-drive', to: parts.length ? folderLink('') : undefined },
		...parts.map((part, index) => ({
			label: part || '(no name)',
			to: index < parts.length - 1 ? folderLink(`${parts.slice(0, index + 1).join('/')}/`) : undefined
		}))
	]
})

// --- Bucket ---------------------------------------------------------------------------------

// status: idle, loading (first check), ready, missing (not created yet) or error. `zone` is the
// zone the status belongs to, so nothing runs against a bucket from the previous zone.
const bucketState = reactive({
	status: 'idle',
	zone: '',
	message: '',
	loading: false,
	creating: false,
	createError: ''
})
let bucketRequest = 0

const ready = computed(() => canUse.value && bucketState.status === 'ready' && bucketState.zone === zoneId.value)

// Only Cloudflare saying the bucket doesn't exist counts as “not set up”. A missing permission
// or R2 not being turned on shows Cloudflare's message instead.
const isMissingBucket = (error) =>
	error instanceof CfApiError &&
	(error.response?.errors || []).some(
		(item) => item?.code === NO_SUCH_BUCKET || /specified bucket does not exist/i.test(String(item?.message || ''))
	)

const loadBucket = async () => {
	const id = zoneId.value
	const name = bucket.value
	if (!id || !name) return
	const request = ++bucketRequest
	const fallback = `Couldn’t open the bucket ${name}`
	bucketState.loading = true
	if (bucketState.status === 'idle' || bucketState.status === 'error') bucketState.status = 'loading'
	try {
		await exec('r2 buckets get', { accountOfZone: id, args: { 'bucket-name': name } }, { fallback })
		if (request !== bucketRequest) return
		Object.assign(bucketState, { status: 'ready', zone: id, message: '', createError: '' })
	} catch (error) {
		if (request !== bucketRequest) return
		Object.assign(bucketState, {
			status: isMissingBucket(error) ? 'missing' : 'error',
			zone: id,
			message: describeError(error, fallback)
		})
	} finally {
		if (request === bucketRequest) bucketState.loading = false
	}
	if (request === bucketRequest && bucketState.status === 'ready') {
		loadListing()
		publicAccess.value?.refresh()
	}
}

const createBucket = async () => {
	const id = zoneId.value
	const name = bucket.value
	if (!id || !name || bucketState.creating) return
	const fallback = `Cloudflare didn’t create the bucket ${name}`
	bucketState.creating = true
	bucketState.createError = ''
	try {
		await exec('r2 buckets create', { accountOfZone: id, body: { name } }, { fallback })
		if (id !== zoneId.value) return
		bucketRequest += 1
		Object.assign(bucketState, { status: 'ready', zone: id, message: '', loading: false })
		notify.success(
			`Created the bucket ${name}`,
			accountName.value ? `In the ${accountName.value} account` : undefined
		)
		loadListing()
	} catch (error) {
		if (id === zoneId.value) bucketState.createError = describeError(error, fallback)
	} finally {
		if (id === zoneId.value) bucketState.creating = false
	}
}

// --- Listing --------------------------------------------------------------------------------

// One folder at a time: `folders` are the prefixes R2 groups under the "/" delimiter, `files`
// the objects directly inside. `cursor` is set while R2 has more to send.
const listing = reactive({
	prefix: '',
	folders: [],
	files: [],
	cursor: '',
	loaded: false,
	loading: false,
	loadingMore: false,
	error: ''
})
let listRequest = 0

const resetListing = (prefix = '') => {
	listRequest += 1
	Object.assign(listing, {
		prefix,
		folders: [],
		files: [],
		cursor: '',
		loaded: false,
		loading: false,
		loadingMore: false,
		error: ''
	})
}

const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)

const loadListing = async ({ more = false } = {}) => {
	const id = zoneId.value
	const name = bucket.value
	const prefix = currentPrefix.value
	if (!ready.value || !name) return
	if (more && (!listing.cursor || listing.loading || listing.loadingMore || listing.prefix !== prefix)) return
	if (!more && listing.prefix !== prefix) resetListing(prefix)

	const request = ++listRequest
	const fallback = 'Couldn’t list the files'
	listing.loading = !more
	listing.loadingMore = more
	if (!more) listing.error = ''
	try {
		const response = await exec(
			'r2 objects list',
			{
				accountOfZone: id,
				flags: {
					'bucket-name': name,
					prefix: prefix || undefined,
					delimiter: '/',
					'per-page': PAGE_SIZE,
					cursor: more ? listing.cursor : undefined
				}
			},
			{ fallback }
		)
		if (request !== listRequest) return
		const info = response?.result_info || {}
		const folders = (Array.isArray(info.delimited) ? info.delimited : []).filter(
			(item) => typeof item === 'string' && item !== prefix
		)
		// A folder marker left by another tool (an empty object named after the folder) isn't a file.
		const files = (Array.isArray(response?.result) ? response.result : []).filter(
			(item) => typeof item?.key === 'string' && item.key !== prefix
		)
		if (more) {
			listing.folders = [...new Set([...listing.folders, ...folders])].sort()
			const seen = new Set(listing.files.map((item) => item.key))
			listing.files = [...listing.files, ...files.filter((item) => !seen.has(item.key))].sort(byKey)
		} else {
			listing.folders = [...new Set(folders)].sort()
			listing.files = files.sort(byKey)
		}
		listing.cursor = info.is_truncated && info.cursor ? String(info.cursor) : ''
		listing.loaded = true
	} catch (error) {
		if (request !== listRequest) return
		if (more) notify.error('Couldn’t load more files', error, fallback)
		else listing.error = describeError(error, fallback)
	} finally {
		if (request === listRequest) {
			listing.loading = false
			listing.loadingMore = false
		}
	}
}

// Set by FilesPublicAccess: the address files can be read from, or '' while the bucket is private.
const publicBase = ref('')
const publicAccess = useTemplateRef('publicAccess')

const publicUrl = (key) =>
	publicBase.value ? `${publicBase.value}/${key.split('/').map(encodeURIComponent).join('/')}` : ''

const rows = computed(() => {
	const prefix = listing.prefix
	return [
		...listing.folders.map((key) => ({
			id: `folder:${key}`,
			kind: 'folder',
			key,
			name: key.slice(prefix.length).replace(/\/$/, '')
		})),
		...listing.files.map((object) => ({
			id: `file:${object.key}`,
			kind: 'file',
			key: object.key,
			name: object.key.slice(prefix.length),
			size: object.size,
			modified: object.last_modified || '',
			type: object.http_metadata?.contentType || '',
			url: publicUrl(object.key)
		}))
	]
})
const fileRows = computed(() => rows.value.filter((row) => row.kind === 'file'))
const getRowId = (row) => row.id

const countLabel = computed(() => {
	const parts = []
	if (listing.folders.length) parts.push(plural(listing.folders.length, 'folder'))
	if (listing.files.length || !parts.length) parts.push(plural(listing.files.length, 'file'))
	return `${parts.join(' · ')}${listing.cursor ? ' · more to load' : ''}`
})

const emptyState = computed(() => {
	const upload = canEdit.value
		? { label: 'Upload files', icon: 'i-lucide-upload', onClick: () => chooseFiles() }
		: null
	if (!currentPrefix.value) {
		return {
			icon: 'i-lucide-folder-open',
			title: `No files in ${bucket.value} yet`,
			description: `Upload files for ${zoneName.value}. They stay private unless you turn on public access below.`,
			actions: upload ? [upload] : undefined
		}
	}
	const parts = folderParts.value
	return {
		icon: 'i-lucide-folder-open',
		title: `${parts[parts.length - 1] || 'This folder'} is empty`,
		description:
			'R2 has no empty folders, so this one is kept once you upload a file into it, and disappears if you leave without adding one.',
		actions: [
			...(upload ? [upload] : []),
			{
				label: 'Back to the folder above',
				icon: 'i-lucide-arrow-up',
				color: 'neutral',
				variant: 'outline',
				to: folderLink(parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '')
			}
		]
	}
})

// --- Selection ------------------------------------------------------------------------------

const selected = ref(new Set())

const selectedRows = computed(() => fileRows.value.filter((row) => selected.value.has(row.key)))
const allSelected = computed(() => fileRows.value.length > 0 && selectedRows.value.length === fileRows.value.length)

const toggleSelected = (row, value) => {
	const next = new Set(selected.value)
	if (value) next.add(row.key)
	else next.delete(row.key)
	selected.value = next
}

const toggleAll = (value) => {
	selected.value = value && !allSelected.value ? new Set(fileRows.value.map((row) => row.key)) : new Set()
}

const clearSelection = () => {
	selected.value = new Set()
}

// --- Row actions ----------------------------------------------------------------------------

const fileActions = (row) => [
	[
		{
			label: downloading.value.has(row.key) ? 'Downloading…' : 'Download',
			icon: 'i-lucide-download',
			disabled: downloading.value.has(row.key),
			onSelect: () => downloadFile(row)
		},
		{ label: 'Copy key', icon: 'i-lucide-copy', onSelect: () => notify.copy(row.key, 'Key') },
		...(row.url
			? [
					{
						label: 'Copy public link',
						icon: 'i-lucide-link',
						onSelect: () => notify.copy(row.url, 'Public link')
					},
					{ label: 'Open public link', icon: 'i-lucide-external-link', to: row.url, target: '_blank' }
				]
			: [])
	],
	...(canDelete.value
		? [[{ label: 'Delete', icon: 'i-lucide-trash-2', color: 'error', onSelect: () => openDelete([row]) }]]
		: [])
]

// --- Download -------------------------------------------------------------------------------

const downloading = ref(new Set())

// $fetch reads an error response as a blob too, so Cloudflare's message has to be read out of it.
const readDownloadError = async (error) => {
	if (!(error?.data instanceof Blob)) return error
	try {
		const data = JSON.parse(await error.data.text())
		return data?.errors?.[0]?.message || data?.message || data?.statusMessage || error
	} catch {
		return error
	}
}

const saveBlob = (blob, filename) => {
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.append(link)
	link.click()
	link.remove()
	// Revoking in the same tick can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0)
}

const downloadFile = async (row) => {
	if (downloading.value.has(row.key)) return
	downloading.value = new Set([...downloading.value, row.key])
	const filename = row.key.split('/').filter(Boolean).pop() || 'download'
	try {
		const blob = await $fetch('/api/r2_download', {
			method: 'POST',
			body: { currZone: zoneId.value, key: row.key },
			responseType: 'blob'
		})
		saveBlob(blob, filename)
	} catch (error) {
		notify.error(
			`Couldn’t download ${filename}`,
			await readDownloadError(error),
			'Cloudflare didn’t return the file'
		)
	} finally {
		const next = new Set(downloading.value)
		next.delete(row.key)
		downloading.value = next
	}
}

// --- Delete ---------------------------------------------------------------------------------

const deleteOpen = ref(false)
const deleteTargets = ref([])
const deleteFailures = ref({})
const deleteSummary = ref(null)
const deleting = ref(false)
const deleteDone = ref(0)

const openDelete = (targets) => {
	if (!targets.length) return
	deleteTargets.value = targets.map(({ key, name }) => ({ key, name }))
	deleteFailures.value = {}
	deleteSummary.value = null
	deleteDone.value = 0
	deleteOpen.value = true
}

const deleteTitle = computed(() =>
	deleteTargets.value.length === 1
		? `Delete ${deleteTargets.value[0].name}?`
		: `Delete ${plural(deleteTargets.value.length, 'file')}?`
)
const deleteDescription = computed(() => {
	const them = deleteTargets.value.length === 1 ? 'it' : 'them'
	const links = publicBase.value ? ` Public links to ${them} stop working.` : ''
	return `Cloudflare removes ${them} from ${bucket.value} straight away.${links} This can’t be undone.`
})
const deleteButtonLabel = computed(() => {
	const total = deleteTargets.value.length
	if (deleting.value) return `Deleting ${formatNumber(deleteDone.value)} of ${formatNumber(total)}…`
	if (deleteSummary.value) return total === 1 ? 'Try again' : `Try ${plural(total, 'file')} again`
	return total === 1 ? 'Delete file' : `Delete ${plural(total, 'file')}`
})

// Delete by list answers with the keys it deleted. Cloudflare says per-key errors come back in
// the same answer without documenting their shape, so an entry carrying an error, or a key left
// out of a list that names others, counts as not deleted.
const readDeleteResult = (response, keys) => {
	const result = response?.result
	const entries = Array.isArray(result) ? result.filter((item) => typeof item?.key === 'string') : []
	const byName = new Map(entries.map((item) => [item.key, item]))
	const deleted = []
	const failed = {}
	for (const key of keys) {
		const entry = byName.get(key)
		const problem = entry?.error || entry?.errors?.[0]
		if (problem) failed[key] = String(problem?.message || problem)
		else if (entry || !byName.size) deleted.push(key)
		else failed[key] = 'Cloudflare didn’t confirm this file was deleted. Refresh to check.'
	}
	return { deleted, failed }
}

const confirmDelete = async () => {
	const targets = deleteTargets.value
	const id = zoneId.value
	const name = bucket.value
	if (!targets.length || deleting.value) return

	deleting.value = true
	deleteDone.value = 0
	deleteSummary.value = null
	deleteFailures.value = {}

	const fallback = 'Cloudflare didn’t delete this file'
	const deleted = []
	const failures = {}
	const keys = targets.map((target) => target.key)
	for (let start = 0; start < keys.length; start += DELETE_BATCH) {
		const batch = keys.slice(start, start + DELETE_BATCH)
		try {
			const response = await exec(
				'r2 objects bulk-delete',
				{ accountOfZone: id, flags: { 'bucket-name': name }, body: batch },
				{ fallback }
			)
			const outcome = readDeleteResult(response, batch)
			deleted.push(...outcome.deleted)
			Object.assign(failures, outcome.failed)
		} catch (error) {
			for (const key of batch) failures[key] = describeError(error, fallback)
		}
		deleteDone.value += batch.length
	}
	deleting.value = false
	if (id !== zoneId.value) return

	if (deleted.length) {
		const gone = new Set(deleted)
		listing.files = listing.files.filter((item) => !gone.has(item.key))
		selected.value = new Set([...selected.value].filter((key) => !gone.has(key)))
	}

	const failedTargets = targets.filter((target) => failures[target.key])
	if (!failedTargets.length) {
		deleteOpen.value = false
		notify.success(
			targets.length === 1 ? `Deleted ${targets[0].name}` : `Deleted ${plural(targets.length, 'file')}`,
			name
		)
		return
	}

	deleteTargets.value = failedTargets
	deleteFailures.value = failures
	deleteSummary.value = {
		title: deleted.length
			? `Deleted ${formatNumber(deleted.length)} of ${plural(targets.length, 'file')}`
			: `Couldn’t delete ${targets.length === 1 ? 'this file' : plural(targets.length, 'file')}`,
		description: `${failedTargets.length === 1 ? 'The file below is' : `The ${formatNumber(failedTargets.length)} files below are`} still in ${name}. Cloudflare’s reason is shown under each one.`
	}
}

// --- New folder -----------------------------------------------------------------------------

// R2 has no folders, only keys with slashes in them. A new folder is opened in the URL rather
// than written as an empty "name/" marker object: markers show up as stray empty files in S3
// tools and would have to be hidden and cleaned up here, while an opened folder exists exactly
// when a file does, as R2 lists it.
const folderOpen = ref(false)
const folderName = ref('')
const folderError = ref('')
const folderFormId = useId()

const openNewFolder = () => {
	folderName.value = ''
	folderError.value = ''
	folderOpen.value = true
}

const checkFolderName = (name, prefix) => {
	if (!name) return 'Enter a name for the folder'
	if (name.includes('/')) return 'Use a name without /. To make a folder inside another, open that one first.'
	if (name === '.' || name === '..') return 'Folders can’t be called “.” or “..”'
	if (CONTROL_CHARACTER.test(name)) return 'Folder names can’t contain control characters'
	if (keyBytes(`${prefix}${name}/`) > MAX_KEY_BYTES - 1) return 'That name makes the folder path too long for R2'
	return ''
}

const createFolder = () => {
	const name = folderName.value.trim()
	folderError.value = checkFolderName(name, currentPrefix.value)
	if (folderError.value) return
	folderOpen.value = false
	router.push(folderLink(`${currentPrefix.value}${name}/`))
}

// --- Upload ---------------------------------------------------------------------------------

// Each upload is tagged with the zone and folder it was dropped into and keeps going when the
// person moves on; a new file shows up in the list only if that folder is still open. Uploads
// they can no longer see, in another zone or after leaving the page, are reported in a toast
// once the last of them settles.
const uploads = ref([])
const picked = ref([])
const uploader = useTemplateRef('uploader')
const uploadRequests = new Map()
let activeUploads = 0
let uploadSequence = 0
let mounted = true

onBeforeUnmount(() => {
	mounted = false
})

const isActive = (item) => item.status === 'waiting' || item.status === 'uploading' || item.status === 'saving'
const isSettled = (item) => !isActive(item)
const isHidden = (item) => !mounted || item.zone !== zoneId.value

const visibleUploads = computed(() => uploads.value.filter((item) => item.zone === zoneId.value))

const uploadSummary = computed(() => {
	const list = visibleUploads.value
	const active = list.filter(isActive).length
	const done = list.filter((item) => item.status === 'done').length
	const failed = list.length - active - done
	const parts = []
	if (active) parts.push(`Uploading ${plural(active, 'file')}`)
	if (done) parts.push(`${formatNumber(done)} uploaded`)
	if (failed) parts.push(`${formatNumber(failed)} not uploaded`)
	return parts.join(' · ')
})

const uploadStatusLabel = (item) =>
	({
		waiting: 'Waiting',
		uploading: `${item.percent}%`,
		saving: 'Saving to R2…',
		done: 'Uploaded',
		failed: 'Failed',
		refused: 'Not uploaded'
	})[item.status]

const checkUpload = (file, key) => {
	if (file.size > MAX_UPLOAD_BYTES) {
		return `${formatBytes(file.size)} is over the ${formatBytes(MAX_UPLOAD_BYTES)} limit for uploads here. Use an S3-compatible tool for bigger files.`
	}
	if (keyBytes(key) > MAX_KEY_BYTES) {
		return 'The folder and file name together are longer than R2’s limit of 1,024 bytes. Rename the file or use a shorter folder.'
	}
	if (CONTROL_CHARACTER.test(key)) return 'The name has control characters in it. Rename the file and try again.'
	if (key.split('/').some((part) => part === '.' || part === '..')) {
		return 'Folders called “.” or “..” can’t hold files uploaded here. Choose another folder.'
	}
	return ''
}

const chooseFiles = () => uploader.value?.inputRef?.click()

watch(picked, (files) => {
	if (!files?.length) return
	addUploads(files)
	picked.value = []
})

const addUploads = (files) => {
	const prefix = currentPrefix.value
	for (const file of files) {
		const key = `${prefix}${file.name}`
		const problem = checkUpload(file, key)
		uploads.value.push({
			id: ++uploadSequence,
			zone: zoneId.value,
			bucket: bucket.value,
			prefix,
			key,
			name: file.name,
			size: file.size,
			type: file.type || 'application/octet-stream',
			file: problem ? null : file,
			status: problem ? 'refused' : 'waiting',
			percent: 0,
			error: problem,
			background: false
		})
	}
	pumpUploads()
}

const uploadError = (status, data) => {
	if (data?.message || data?.statusMessage) return data.message || data.statusMessage
	if (status === 413) {
		return 'The server refused a file this large. If DNS Manager runs behind a proxy, raise the proxy’s upload limit.'
	}
	return `The upload didn’t finish (HTTP ${status}). Try again.`
}

// XMLHttpRequest rather than $fetch, for upload progress. The route answers with Cloudflare's
// envelope, or a 4xx with a plain message for input it won't send.
const sendUpload = (item) =>
	new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest()
		uploadRequests.set(item.id, xhr)
		const query = new URLSearchParams({ zone: item.zone, key: item.key, type: item.type })
		xhr.open('POST', `/api/r2_upload?${query}`)
		xhr.setRequestHeader('content-type', 'application/octet-stream')
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && event.total > 0) {
				item.percent = Math.min(100, Math.round((event.loaded / event.total) * 100))
			}
		}
		// Every byte has reached this app's server, which is now sending the file on to R2.
		xhr.upload.onload = () => {
			if (item.status === 'uploading') item.status = 'saving'
		}
		xhr.onload = () => {
			let data = null
			try {
				data = JSON.parse(xhr.responseText)
			} catch {
				// Not JSON, such as a proxy's error page.
			}
			if (xhr.status >= 400) reject(new Error(uploadError(xhr.status, data)))
			else if (!data || data.success === false) {
				reject(new CfApiError(cfErrorMessage(data, 'Cloudflare didn’t store the file'), data))
			} else resolve(data)
		}
		xhr.onerror = () =>
			reject(new Error('Couldn’t reach the DNS Manager server. Check your connection and try again.'))
		xhr.onabort = () => reject(new Error('Upload cancelled'))
		xhr.send(item.file)
	})

const runUpload = async (item) => {
	item.status = 'uploading'
	item.percent = 0
	item.error = ''
	try {
		const response = await sendUpload(item)
		item.status = 'done'
		item.file = null
		addUploadedFile(item, response?.result)
	} catch (error) {
		if (item.status === 'cancelled') return
		item.status = 'failed'
		item.error = describeError(error, 'The upload didn’t finish. Try again.')
	} finally {
		uploadRequests.delete(item.id)
		if (isHidden(item)) item.background = true
	}
}

const pumpUploads = () => {
	while (activeUploads < UPLOAD_CONCURRENCY) {
		const item = uploads.value.find((entry) => entry.status === 'waiting')
		if (!item) return
		activeUploads += 1
		runUpload(item).finally(() => {
			activeUploads -= 1
			pumpUploads()
			reportHiddenUploads()
		})
	}
}

// The file joins the open folder's list, or its folder does if it went into one below.
const addUploadedFile = (item, result) => {
	if (item.zone !== zoneId.value || !listing.loaded || !item.prefix.startsWith(listing.prefix)) return
	if (item.prefix !== listing.prefix) {
		const folder = `${listing.prefix}${item.prefix.slice(listing.prefix.length).split('/')[0]}/`
		if (!listing.folders.includes(folder)) listing.folders = [...listing.folders, folder].sort()
		return
	}
	const object = {
		key: result?.key || item.key,
		size: Number(result?.size) || item.size,
		last_modified: result?.uploaded || new Date().toISOString(),
		etag: result?.etag,
		http_metadata: { contentType: item.type }
	}
	listing.files = [...listing.files.filter((entry) => entry.key !== object.key), object].sort(byKey)
}

const reportHiddenUploads = () => {
	const hidden = uploads.value.filter(isHidden)
	if (hidden.some(isActive)) return
	const settled = hidden.filter((item) => item.background)
	if (!settled.length) return
	uploads.value = uploads.value.filter((item) => !item.background || !isHidden(item))
	for (const name of new Set(settled.map((item) => item.bucket))) {
		const group = settled.filter((item) => item.bucket === name)
		const failed = group.filter((item) => item.status !== 'done')
		if (!failed.length) notify.success(`Uploaded ${plural(group.length, 'file')} to ${name}`)
		else {
			notify.warning(
				`Uploaded ${formatNumber(group.length - failed.length)} of ${plural(group.length, 'file')} to ${name}`,
				`Not uploaded: ${failed.map((item) => item.name).join(', ')}`
			)
		}
	}
}

const retryUpload = (item) => {
	if (item.status !== 'failed' || !item.file) return
	item.status = 'waiting'
	item.error = ''
	pumpUploads()
}

// Once every byte has gone, the server may already be storing the file, so it can't be recalled.
const cancelUpload = (item) => {
	if (item.status === 'uploading') {
		item.status = 'cancelled'
		uploadRequests.get(item.id)?.abort()
	} else if (item.status !== 'waiting') return
	uploads.value = uploads.value.filter((entry) => entry.id !== item.id)
}

const dismissUpload = (item) => {
	uploads.value = uploads.value.filter((entry) => entry.id !== item.id)
}

const clearFinished = () => {
	uploads.value = uploads.value.filter((item) => item.zone !== zoneId.value || isActive(item))
}

// --- Loading and zone changes ---------------------------------------------------------------

const refreshing = computed(() => bucketState.loading || listing.loading)

const refreshAll = () => {
	if (!bucket.value && zoneError.value) refreshZone()
	else loadBucket()
}

// Anything opened for one zone's bucket closes when the zone changes, and answers still on
// their way for it are dropped.
const resetForZone = () => {
	bucketRequest += 1
	Object.assign(bucketState, {
		status: 'idle',
		zone: '',
		message: '',
		loading: false,
		creating: false,
		createError: ''
	})
	resetListing(currentPrefix.value)
	publicBase.value = ''
	clearSelection()
	deleteOpen.value = false
	folderOpen.value = false
	// Uploads for the previous zone that are already settled have nothing left to report.
	uploads.value = uploads.value.filter((item) => isActive(item) || item.zone === zoneId.value)
}

watch(
	zoneId,
	(id) => {
		if (id) loadZone()
	},
	{ immediate: true }
)

watch(
	[zoneId, canUse, bucket],
	([id, available, name], previous) => {
		if (previous && previous[0] !== id) resetForZone()
		if (id && available && name) loadBucket()
	},
	{ immediate: true }
)

watch(currentPrefix, () => {
	clearSelection()
	if (ready.value) loadListing()
})
</script>
