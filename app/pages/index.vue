<script setup>
// Never renders: "/" goes to the zones list, and the auth middleware sends anyone
// without a saved token to /login instead.
definePageMeta({ redirect: '/zones' })
</script>
