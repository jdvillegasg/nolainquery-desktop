from query_execution.sandbox_environment import sandbox_environment_spec


def test_sandbox_environment_spec():
    spec = sandbox_environment_spec()
    preloaded_names = {item["name"] for item in spec["preloaded"]}
    assert {"df", "result", "pd", "np", "math", "datetime"}.issubset(preloaded_names)
    assert "scipy" in spec["allowed_imports"]
    assert "scipy.stats" in spec["allowed_imports"]
    assert "pandas" not in spec["allowed_imports"]
    assert "print" in spec["builtins"]
    assert "__import__" not in spec["builtins"]
    assert spec["toolbar_names"] == ["pd", "np", "math", "datetime", "df", "result"]
    assert "result" in spec["starter_snippet"]
