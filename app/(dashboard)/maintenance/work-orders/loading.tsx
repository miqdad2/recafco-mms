export default function WorkOrdersLoading() {
  return (
    <>
      {/* Page header skeleton */}
      <div className="border-b border-[#DDE2EA] bg-white px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex items-center justify-between border-l-4 border-[#ED1C24] pl-4">
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-gray-200" />
            <div className="h-7 w-64 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-96 animate-pulse rounded bg-gray-200" />
          </div>
          <div className="h-9 w-40 animate-pulse rounded-md bg-gray-200" />
        </div>
      </div>

      <div className="space-y-4 p-4 lg:p-6">
        {/* KPI cards skeleton */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="h-8 w-8 animate-pulse rounded-md bg-gray-200" />
                <div className="h-7 w-10 animate-pulse rounded bg-gray-200" />
              </div>
              <div className="mt-3 h-3 w-28 animate-pulse rounded bg-gray-200" />
              <div className="mt-1.5 h-3 w-36 animate-pulse rounded bg-gray-200" />
            </div>
          ))}
        </div>

        {/* Quick actions skeleton */}
        <div className="rounded-md border border-[#E5E7EB] bg-white px-4 py-3 shadow-sm">
          <div className="mb-2.5 h-3 w-40 animate-pulse rounded bg-gray-200" />
          <div className="flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-7 w-24 animate-pulse rounded-md bg-gray-200" />
            ))}
          </div>
        </div>

        {/* Filter skeleton */}
        <div className="rounded-md border border-[#E5E7EB] bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`h-10 animate-pulse rounded-md bg-gray-200 ${i === 0 ? "sm:col-span-2 xl:col-span-2" : ""}`} />
            ))}
          </div>
        </div>

        {/* Tabs skeleton */}
        <div className="flex gap-1 overflow-hidden rounded-md border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-6 w-20 animate-pulse rounded bg-gray-200" />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="border-b border-[#E5E7EB] bg-gray-50 px-4 py-3">
            <div className="h-3 w-32 animate-pulse rounded bg-gray-200" />
            <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-gray-200" />
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {Array.from({ length: 9 }).map((_, i) => (
                  <th key={i} className="px-4 py-3">
                    <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {Array.from({ length: 10 }).map((_, row) => (
                <tr key={row}>
                  <td className="px-4 py-3">
                    <div className="h-4 w-36 animate-pulse rounded bg-gray-200" />
                    <div className="mt-1.5 h-3 w-24 animate-pulse rounded bg-gray-200" />
                    <div className="mt-1.5 h-1 w-32 animate-pulse rounded-full bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
                    <div className="mt-1 h-3 w-20 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-20 animate-pulse rounded bg-gray-200" />
                    <div className="mt-1 h-3 w-16 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-6 w-16 animate-pulse rounded-md bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-6 w-24 animate-pulse rounded-md bg-gray-200" />
                    <div className="mt-1 h-3 w-28 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-24 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3 w-12 animate-pulse rounded bg-gray-200" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="ml-auto h-7 w-14 animate-pulse rounded-md bg-gray-200" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination skeleton */}
        <div className="flex items-center justify-between rounded-md border border-[#E5E7EB] bg-white p-3">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-9 w-24 animate-pulse rounded-md bg-gray-200" />
            <div className="h-9 w-16 animate-pulse rounded-md bg-gray-200" />
          </div>
        </div>
      </div>
    </>
  );
}
