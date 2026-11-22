// Pure (no "use client"): imported by config/sections.ts, which server pages use too.

/**
 * Config grid tiles: every tile in a row as tall as the tallest one, and
 * never shorter than a square. The grid is a size container (`@container`),
 * so 100cqw is its width; a column is (width − gaps) / columns, with the
 * grid's own breakpoints (2 / sm 3 / md 4 / lg 5 / xl 4 columns, gap-3).
 * Without aspect-ratio, the grid's default stretch evens out each row.
 */
export const TILE_ROW_SIZE =
  "min-h-[calc((100cqw_-_0.75rem)/2)] sm:min-h-[calc((100cqw_-_1.5rem)/3)] md:min-h-[calc((100cqw_-_2.25rem)/4)] lg:min-h-[calc((100cqw_-_3rem)/5)] xl:min-h-[calc((100cqw_-_2.25rem)/4)]";
