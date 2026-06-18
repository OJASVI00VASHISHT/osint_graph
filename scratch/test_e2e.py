import requests
import time

def test_e2e():
    payload = {
        "query": "hehe_ojasvi",
        "query_type": "username"
    }
    r = requests.post("http://localhost:8000/api/investigate", json=payload)
    print("Start Investigation Response:", r.json())
    inv_id = r.json()["id"]
    
    status = "pending"
    while status in ("pending", "running"):
        time.sleep(2)
        r = requests.get(f"http://localhost:8000/api/investigation/{inv_id}")
        status = r.json()["status"]
        print(f"Polling Status: {status}")
        
    r = requests.get(f"http://localhost:8000/api/graph/{inv_id}")
    graph_data = r.json()
    print("\n=== GRAPH NODES ===")
    for node in graph_data.get("nodes", []):
        print(f"Node: ID={node['id']} | Type={node.get('label') or node.get('nodeType')} | Label={node.get('label') or node.get('name') or node.get('value')}")
        
    print("\n=== GRAPH EDGES ===")
    for edge in graph_data.get("edges", []):
        print(f"Edge: {edge['source']} -[{edge['label']}]-> {edge['target']}")

if __name__ == "__main__":
    test_e2e()
