import './FilterPanel.css';

interface FilterPanelProperties {
    categories: string[],
    selectedCategory: string | null,
    onSelect: (category: string | null) => void,
    count: number
}

export default function FilterPanel({categories, selectedCategory, onSelect, count}: FilterPanelProperties) {
    return (
        <div className="filter-panel">
            <span className="filter-panel__label">Category:</span>
            <button
                className={selectedCategory === null ? 'is-selected' : undefined}
                onClick={() => onSelect(null)}
            >
                All
            </button>
            {categories.map((category) =>
                <button
                    key={category}
                    className={selectedCategory === category ? 'is-selected' : undefined}
                    onClick={() => onSelect(category)}
                >
                    {category}
                </button>
            )}
            
            <span className="filter-panel__count">{count} pins</span>
        </div>
    )
}
