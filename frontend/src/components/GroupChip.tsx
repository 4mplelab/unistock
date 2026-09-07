export default function GroupChip({ group }: { group: string }) {
  return (
    <span className="inline-flex h-5 w-fit shrink-0 items-center whitespace-nowrap rounded-md bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-400/30 dark:text-gray-100">
      {group}
    </span>
  );
}
